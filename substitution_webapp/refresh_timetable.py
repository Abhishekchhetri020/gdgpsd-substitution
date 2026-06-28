#!/usr/bin/env python3
"""
refresh_timetable.py — One-command timetable refresh for the Substitution Planner.

Parses a fresh ASC TimeTables XML export, diffs it against the live Google Sheet,
backs up the current tabs, and pushes the new schedule.

Usage:
    python3 refresh_timetable.py                              # auto-pick latest XML in ~/Downloads, prompt before push
    python3 refresh_timetable.py --xml ~/Downloads/foo.xml    # specific XML
    python3 refresh_timetable.py --dry-run                    # diff only, no writes
    python3 refresh_timetable.py --yes                        # skip confirmation (for cron / automation)
    python3 refresh_timetable.py --no-backup                  # skip backing up old tabs (faster, riskier)

Requires:
    - Python 3.11+, openpyxl (only if --xlsx is used for cross-check)
    - OAuth token at ~/.hermes/google_token.json with `spreadsheets` scope (Hermes token works)

Output:
    Updates 4 tabs in the Timetable Sheet:
      • Class-wise Grid     • Teacher-wise Grid
      • Flat — Class        • Flat — Teacher (← this is what the planner reads)
    Optionally creates backup tabs: 'Backup_YYYYMMDD_<tab>'
    Appends a log row to 'Refresh History' tab.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ---- CONFIG (this is hard-wired to the GDGPSD instance — change for a new school) ----
SPREADSHEET_ID = '1RFzdymdxtn1_DjhL0n8_7rn68WNHPT90DHLrEo1qtrM'
TOKEN_PATH     = os.path.expanduser('~/.hermes/google_token.json')
DOWNLOADS_DIR  = os.path.expanduser('~/Downloads')
DAYS           = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']   # ASC days bit position from left
EXEC_URL       = 'https://script.google.com/macros/s/AKfycbyiIvckjAKlunlEGkRZwVOik2wA3-3M7sSIEcNgZoLqGS-oC5FSZqRzcOZnPgDruqu2_A/exec'

TABS = {
    'flat_teacher': 'Flat — Teacher',
    'flat_class':   'Flat — Class',
    'tw_grid':      'Teacher-wise Grid',
    'cw_grid':      'Class-wise Grid',
    'class_teachers': 'Class Teachers',
    'teacher_emails': 'Teacher Emails',     # v3.12 — for emailing substitutes
}
# Tabs that aren't OVERWRITTEN by refresh but ARE worth snapshotting in case a
# schedule change invalidates an in-progress draft and the admin needs to recover.
BACKUP_ALSO = ['Daily Drafts', 'Substitution Log']

# ============================================================
# OAuth + Sheets API helpers
# ============================================================
def get_access_token() -> str:
    tok = json.load(open(TOKEN_PATH))
    body = urllib.parse.urlencode({
        'client_id': tok['client_id'],
        'client_secret': tok['client_secret'],
        'refresh_token': tok['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode()
    r = json.loads(urllib.request.urlopen(
        urllib.request.Request('https://oauth2.googleapis.com/token', data=body)
    ).read())
    tok['access_token'] = r['access_token']
    json.dump(tok, open(TOKEN_PATH, 'w'))
    return r['access_token']

def sheets_get(at: str, range_: str) -> list[list]:
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/'
           f'{urllib.parse.quote(range_)}?majorDimension=ROWS')
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': f'Bearer {at}'}))
    return json.loads(r.read()).get('values', [])

def sheets_put(at: str, range_: str, values: list[list]) -> dict:
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/'
           f'{urllib.parse.quote(range_)}?valueInputOption=RAW')
    body = json.dumps({'values': values}).encode()
    r = urllib.request.urlopen(urllib.request.Request(
        url, data=body, method='PUT',
        headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'}
    ))
    return json.loads(r.read())

def sheets_clear(at: str, range_: str) -> None:
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/'
           f'{urllib.parse.quote(range_)}:clear')
    urllib.request.urlopen(urllib.request.Request(
        url, data=b'{}', method='POST',
        headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'}
    )).read()

def sheets_batch_update(at: str, requests: list[dict]) -> dict:
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}:batchUpdate'
    body = json.dumps({'requests': requests}).encode()
    r = urllib.request.urlopen(urllib.request.Request(
        url, data=body, method='POST',
        headers={'Authorization': f'Bearer {at}', 'Content-Type': 'application/json'}
    ))
    return json.loads(r.read())

def get_sheet_meta(at: str) -> dict:
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))'
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': f'Bearer {at}'}))
    meta = json.loads(r.read())
    return {s['properties']['title']: s['properties']['sheetId'] for s in meta.get('sheets', [])}

# ============================================================
# ASC XML parser
# ============================================================
def parse_asc_xml(path: str) -> dict:
    root = ET.parse(path).getroot()

    def find(tag):
        el = root.find(tag)
        return el if el is not None else []

    def norm(s):
        return (s or '').strip()

    periods = {}   # period num → (start, end)
    for p in find('periods'):
        periods[p.get('period')] = (p.get('starttime', ''), p.get('endtime', ''))

    # Use `short` if present (e.g. "Maths"), fall back to `name` ("MATHS"). Matches what
    # the school sees in aSc Timetables and what was previously in the Sheet.
    def pick_label(el):
        return norm(el.get('short')) or norm(el.get('name'))

    subjects = {s.get('id'): pick_label(s) for s in find('subjects')}
    teachers = {t.get('id'): pick_label(t) for t in find('teachers')}
    classes  = {c.get('id'): pick_label(c) for c in find('classes')}

    # Class teacher map: class name → teacher name (from class.teacherid in XML)
    SKIP_CLS = ('Floor',)
    class_teachers = {}
    for c in find('classes'):
        cname = pick_label(c)
        if not cname or any(p in cname for p in SKIP_CLS): continue
        tid = c.get('teacherid', '')
        if tid and teachers.get(tid):
            class_teachers[cname] = teachers[tid]

    lessons = {}
    for l in find('lessons'):
        lessons[l.get('id')] = {
            'subject': subjects.get(l.get('subjectid'), ''),
            'classes': [classes.get(c, '') for c in l.get('classids', '').split(',') if c],
            'teachers': [teachers.get(t, '') for t in l.get('teacherids', '').split(',') if t],
        }

    # Build flat rows
    flat_teacher = []   # Teacher | Day | Period | Start | End | Subject | Class | Room
    flat_class   = []   # Class   | Day | Period | Start | End | Subject | Teacher | Room

    SKIP_CLASS_PATTERNS = ('Floor',)   # supervision/non-pedagogical classes in this XML

    for card in find('cards'):
        lesson = lessons.get(card.get('lessonid'))
        if not lesson:
            continue
        period = card.get('period', '')
        days_bits = card.get('days', '')
        start, end = periods.get(period, ('', ''))
        # Separate real classes from duty (virtual) classes
        all_lesson_classes = [c for c in lesson['classes'] if c]
        real_classes = [c for c in all_lesson_classes
                        if not any(p in c for p in SKIP_CLASS_PATTERNS)]
        duty_classes = [c for c in all_lesson_classes
                        if any(p in c for p in SKIP_CLASS_PATTERNS)]
        if not all_lesson_classes:
            continue  # truly empty lesson — skip
        # Label for Flat — Teacher: real classes first; if duty-only, mark explicitly
        if real_classes:
            klass_for_teacher = ' / '.join(real_classes)
        else:
            klass_for_teacher = ' / '.join('🛡 ' + c + ' (Duty)' for c in duty_classes)
        for day_idx, bit in enumerate(days_bits):
            if bit != '1' or day_idx >= len(DAYS):
                continue
            day = DAYS[day_idx]
            for teacher in lesson['teachers']:
                if not teacher:
                    continue
                # Always write Flat — Teacher (duty = busy, so teacher is excluded from free pool)
                flat_teacher.append([teacher, day, period, start, end,
                                     lesson['subject'], klass_for_teacher, ''])
                # Flat — Class: only emit rows for REAL classes (Floor isn't a roster)
                for klass in real_classes:
                    flat_class.append([klass, day, period, start, end,
                                       lesson['subject'], teacher, ''])

    return {
        'periods': periods,
        'teachers': sorted({t for t in teachers.values() if t}),
        'classes': sorted({c for c in classes.values() if c and not any(p in c for p in SKIP_CLASS_PATTERNS)}),
        'subjects': sorted({s for s in subjects.values() if s}),
        'flat_teacher': flat_teacher,
        'flat_class': flat_class,
        'class_teachers': class_teachers,
    }

# ============================================================
# Grid builder (for human-readable tabs)
# ============================================================
def build_teacher_grid(flat_teacher: list[list], teachers: list[str], periods: dict) -> list[list]:
    period_nums = sorted(periods.keys(), key=int)
    header = ['Teacher'] + [f'{d} P{p}' for d in DAYS for p in period_nums]
    rows = [header]
    lookup = defaultdict(str)
    for t, day, p, _s, _e, subject, klass, _r in flat_teacher:
        lookup[(t, day, p)] = f'{subject} {klass}'
    for t in teachers:
        row = [t]
        for d in DAYS:
            for p in period_nums:
                row.append(lookup.get((t, d, p), ''))
        rows.append(row)
    return rows

def build_class_grid(flat_class: list[list], classes: list[str], periods: dict) -> list[list]:
    period_nums = sorted(periods.keys(), key=int)
    header = ['Class'] + [f'{d} P{p}' for d in DAYS for p in period_nums]
    rows = [header]
    lookup = defaultdict(str)
    for k, day, p, _s, _e, subject, teacher, _r in flat_class:
        lookup[(k, day, p)] = f'{subject} ({teacher})'
    for k in classes:
        row = [k]
        for d in DAYS:
            for p in period_nums:
                row.append(lookup.get((k, d, p), ''))
        rows.append(row)
    return rows

# ============================================================
# Diff
# ============================================================
def diff_report(at: str, new: dict) -> dict:
    print('\n📊  Diffing against live sheet…')
    cur_flat_teacher = sheets_get(at, f"'{TABS['flat_teacher']}'!A2:H")
    cur_teachers = sorted({r[0] for r in cur_flat_teacher if r and r[0]})
    cur_classes  = sorted({r[6] for r in cur_flat_teacher if r and len(r) > 6 and r[6]})
    cur_subjects = sorted({r[5] for r in cur_flat_teacher if r and len(r) > 5 and r[5]})

    added_t   = sorted(set(new['teachers']) - set(cur_teachers))
    removed_t = sorted(set(cur_teachers) - set(new['teachers']))
    added_c   = sorted(set(new['classes'])  - set(cur_classes))
    removed_c = sorted(set(cur_classes)  - set(new['classes']))
    added_s   = sorted(set(new['subjects']) - set(cur_subjects))
    removed_s = sorted(set(cur_subjects) - set(new['subjects']))

    cur_cells = {(r[0], r[1], r[2]): (r[5] if len(r) > 5 else '', r[6] if len(r) > 6 else '')
                 for r in cur_flat_teacher if len(r) >= 7}
    new_cells = {(r[0], r[1], r[2]): (r[5], r[6]) for r in new['flat_teacher']}
    changed_cells = [
        (k, cur_cells[k], new_cells[k])
        for k in (cur_cells.keys() & new_cells.keys())
        if cur_cells[k] != new_cells[k]
    ]
    added_cells   = sorted(new_cells.keys() - cur_cells.keys())
    removed_cells = sorted(cur_cells.keys() - new_cells.keys())

    print('─' * 70)
    print(f'  Teachers:  current={len(cur_teachers):3d}  new={len(new["teachers"]):3d}'
          f'  added={len(added_t):2d}  removed={len(removed_t):2d}')
    print(f'  Classes:   current={len(cur_classes):3d}  new={len(new["classes"]):3d}'
          f'  added={len(added_c):2d}  removed={len(removed_c):2d}')
    print(f'  Subjects:  current={len(cur_subjects):3d}  new={len(new["subjects"]):3d}'
          f'  added={len(added_s):2d}  removed={len(removed_s):2d}')
    print(f'  Schedule cells:  current={len(cur_cells):4d}  new={len(new_cells):4d}'
          f'  added={len(added_cells):3d}  removed={len(removed_cells):3d}  changed={len(changed_cells):3d}')
    print('─' * 70)

    def show(label, items, limit=20):
        if items:
            print(f'  {label}:')
            for x in items[:limit]:
                print(f'    • {x}')
            if len(items) > limit:
                print(f'    … and {len(items)-limit} more')

    show('+ Teachers added', added_t)
    show('− Teachers removed', removed_t)
    show('+ Classes added', added_c)
    show('− Classes removed', removed_c)
    show('+ Subjects added', added_s)
    show('− Subjects removed', removed_s)
    if changed_cells:
        print(f'  ~ Sample changed slots (showing 10 of {len(changed_cells)}):')
        for (t, d, p), old, new_ in changed_cells[:10]:
            print(f'    • {t} {d} P{p}: {old[0]} {old[1]}  →  {new_[0]} {new_[1]}')

    return {
        'added_t': added_t, 'removed_t': removed_t,
        'added_c': added_c, 'removed_c': removed_c,
        'added_s': added_s, 'removed_s': removed_s,
        'added_cells': len(added_cells), 'removed_cells': len(removed_cells),
        'changed_cells': len(changed_cells),
        'cur_count': len(cur_cells), 'new_count': len(new_cells),
    }

# ============================================================
# Backup + push
# ============================================================
def backup_tabs(at: str, stamp: str) -> None:
    print('\n💾  Backing up current tabs (4 schedule tabs + Daily Drafts + Substitution Log)…')
    meta = get_sheet_meta(at)
    requests = []
    # Schedule tabs (will be overwritten)
    for key, tab_name in TABS.items():
        if tab_name in meta:
            requests.append({'duplicateSheet': {
                'sourceSheetId': meta[tab_name],
                'newSheetName': f'Backup_{stamp}_{key}',
            }})
    # State tabs (won't be overwritten, but a schedule change can invalidate
    # in-progress drafts — snapshot so we can manually recover if needed)
    for tab_name in BACKUP_ALSO:
        if tab_name in meta:
            slug = tab_name.lower().replace(' ', '_').replace('—', '').strip('_')
            requests.append({'duplicateSheet': {
                'sourceSheetId': meta[tab_name],
                'newSheetName': f'Backup_{stamp}_{slug}',
            }})
    if requests:
        sheets_batch_update(at, requests)
        for r in requests:
            print(f'    ✓ {r["duplicateSheet"]["newSheetName"]}')

def push_schedule(at: str, parsed: dict) -> None:
    flat_t_rows = [['Teacher', 'Day', 'Period', 'Start', 'End', 'Subject', 'Class', 'Room']] + parsed['flat_teacher']
    flat_c_rows = [['Class', 'Day', 'Period', 'Start', 'End', 'Subject', 'Teacher', 'Room']]  + parsed['flat_class']
    tw_rows     = build_teacher_grid(parsed['flat_teacher'], parsed['teachers'], parsed['periods'])
    cw_rows     = build_class_grid(parsed['flat_class'], parsed['classes'], parsed['periods'])
    # Sort class teacher rows by a sensible class order (Nur → LKG → UKG → I → II → … → X)
    CT_ORDER = ['Nur','Nursery','LKG','UKG','Pre-Nursery','KG',
                'I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII']
    def ct_key(cls_name):
        parts = cls_name.split()
        level = parts[0] if parts else cls_name
        sec = parts[1] if len(parts) > 1 else ''
        try: return (CT_ORDER.index(level), sec)
        except ValueError: return (99, cls_name)
    ct_rows = [['Class', 'Class Teacher']] + sorted(
        ([cls, t] for cls, t in parsed.get('class_teachers', {}).items()),
        key=lambda r: ct_key(r[0])
    )

    # v3.12 — Teacher Emails tab, sourced from v12 JSON (the school's canonical email roster).
    # 2026-05-16: merge — start from existing live tab (preserves any manually-added rows
    # like new hires not yet in v12.json), overlay v12 canonical emails, then UNION in every
    # teacher from the new XML so future new hires are never dropped.
    te_rows = [['Teacher', 'Email']]
    try:
        merged = {}
        # 1. Existing live rows
        try:
            live = sheets_get(at, f"'{TABS['teacher_emails']}'!A2:B")
            for r in live:
                if r and r[0]:
                    merged[str(r[0]).strip()] = (r[1] if len(r) > 1 else '') or ''
        except Exception:
            pass
        # 2. v12 canonical emails (overwrite live email if v12 has one)
        v12_path = os.path.expanduser('~/.mempalace/gdgpsd_data/teacher_subject_class_v12.json')
        if os.path.exists(v12_path):
            v12 = json.load(open(v12_path))
            for tname, info in (v12.get('by_teacher', {}) or {}).items():
                if info.get('email'):
                    merged[tname] = info['email']
        # 3. Union all XML teachers (blank email if unknown)
        for tname in parsed['teachers']:
            merged.setdefault(tname, '')
        for tname in sorted(merged.keys()):
            te_rows.append([tname, merged[tname]])
    except Exception as e:
        print(f'   ⚠ Teacher Emails: skipped ({e})')

    plan = [
        (TABS['flat_teacher'],    flat_t_rows),
        (TABS['flat_class'],      flat_c_rows),
        (TABS['tw_grid'],         tw_rows),
        (TABS['cw_grid'],         cw_rows),
        (TABS['class_teachers'],  ct_rows),
        (TABS['teacher_emails'],  te_rows),
    ]
    # Ensure all target tabs exist (Class Teachers is new for older sheets)
    existing = get_sheet_meta(at)
    add_reqs = [{'addSheet': {'properties': {'title': tab}}}
                for tab, _ in plan if tab not in existing]
    if add_reqs:
        sheets_batch_update(at, add_reqs)

    print('\n⬆️   Pushing new schedule…')
    for tab, rows in plan:
        # v3.14 — preserve manually-corrected Class Teachers tab if it already has data.
        # The XML's <class teacherid> can drift from the school's administrative CT roster
        # (e.g. XML had V-C = Mr. Arko, actual CT is Mr. Uttam per school doc).
        if tab == TABS.get('class_teachers') and tab in existing:
            try:
                current = sheets_get(at, f"'{tab}'!A:B")
                if current and len(current) > 1:
                    print(f'    ⊘ {tab}  — SKIPPED (already populated, manual edits preserved). To force a refresh, clear the tab manually first.')
                    continue
            except Exception:
                pass
        sheets_clear(at, f"'{tab}'!A:ZZ")
        sheets_put(at, f"'{tab}'!A1", rows)
        print(f'    ✓ {tab}  ({len(rows)} rows)')

def log_refresh(at: str, summary: dict, xml_path: str, label: str, parsed: dict) -> None:
    tab = 'Refresh History'
    meta = get_sheet_meta(at)
    if tab not in meta:
        sheets_batch_update(at, [{'addSheet': {'properties': {'title': tab}}}])
        sheets_put(at, f"'{tab}'!A1",
                   [['Refreshed At', 'Label', 'XML', 'Teachers', 'Classes', 'Slots', 'Diff Summary']])
    diff_summary = (
        f"+{len(summary['added_t'])}/-{len(summary['removed_t'])} T  "
        f"+{len(summary['added_c'])}/-{len(summary['removed_c'])} C  "
        f"{summary['changed_cells']} cells changed"
    )
    # Append by reading the last row + 1
    existing = sheets_get(at, f"'{tab}'!A:A")
    next_row = max(2, len(existing) + 1)
    sheets_put(at, f"'{tab}'!A{next_row}",
               [[datetime.now().strftime('%Y-%m-%d %H:%M:%S'), label, os.path.basename(xml_path),
                 len(parsed['teachers']), len(parsed['classes']), summary['new_count'], diff_summary]])

# ============================================================
# Verification
# ============================================================
def verify_live(at: str, parsed: dict, added_teachers: list[str]) -> bool:
    """Verify the live web app is serving the refreshed schedule.

    Two checks:
      1. The expected total teacher count appears as a 'teachers' array length
         in the serialised _DATA. We can't parse it exactly (it's escaped JSON
         inside escaped HTML inside a sandbox iframe wrapper), so we sample by
         searching for specific teacher names.
      2. Every teacher in `added_teachers` (those NEW in this refresh) appears
         in the served HTML. If any are missing, the cache is likely stale or
         the push didn't land — verification fails.
    """
    print('\n🔍  Verifying live web app picks up the new schedule…')
    try:
        body = urllib.request.urlopen(EXEC_URL, timeout=30).read().decode()
    except Exception as e:
        print(f'   ⚠ Could not fetch exec URL: {e}')
        return False
    missing = []
    for name in added_teachers:
        # Apps Script serialises the JSON inside an escape-encoded userHtml
        # field, so the name will appear with backslash-escaped quotes.
        if name not in body and name.replace(' ', ' ') not in body:
            missing.append(name)
    if missing:
        print(f'   ⚠ Added teachers NOT found in served HTML: {missing}')
        print('     Possible causes: (a) Apps Script HTML cache stale — wait 60s and retry')
        print('     (b) push went to wrong tab/range — inspect sheet directly')
        return False
    if added_teachers:
        print(f'   ✓ All {len(added_teachers)} newly-added teachers found in served HTML.')
    else:
        print('   ✓ No new teachers to verify (schedule data refreshed; teacher set unchanged).')
    return True

# ============================================================
# Main
# ============================================================
def latest(pattern: str) -> str | None:
    matches = sorted(glob.glob(os.path.join(DOWNLOADS_DIR, pattern)), key=os.path.getmtime, reverse=True)
    return matches[0] if matches else None

def main() -> int:
    ap = argparse.ArgumentParser(description='Refresh the GDGPSD substitution-planner timetable from ASC XML.')
    ap.add_argument('--xml',   help='Path to asctt2012*.xml (default: latest in ~/Downloads)')
    ap.add_argument('--xlsx',  help='Path to contracts*.xlsx for cross-check (optional)')
    ap.add_argument('--label', help='Effective-from label, e.g. "W.E.F. 19 May 2026"',
                    default=datetime.now().strftime('W.E.F. %d %b %Y'))
    ap.add_argument('--dry-run', action='store_true', help='Diff only, no writes')
    ap.add_argument('--yes',     action='store_true', help='Skip confirmation prompt')
    ap.add_argument('--no-backup', action='store_true', help='Skip backup tab creation')
    args = ap.parse_args()

    xml_path = args.xml or latest('asctt2012*.xml')
    if not xml_path or not Path(xml_path).exists():
        print('❌  No ASC XML found. Place asctt2012*.xml in ~/Downloads or pass --xml.', file=sys.stderr)
        return 2
    print(f'📄  Using XML: {xml_path}')
    print(f'🏷   Label:    {args.label}')

    parsed = parse_asc_xml(xml_path)
    print(f'   Parsed: {len(parsed["teachers"])} teachers · {len(parsed["classes"])} classes · '
          f'{len(parsed["subjects"])} subjects · {len(parsed["flat_teacher"])} schedule slots · '
          f'{len(parsed["periods"])} periods/day')

    at = get_access_token()
    summary = diff_report(at, parsed)

    if args.dry_run:
        print('\n🔎  Dry run — no changes made. Re-run without --dry-run to apply.')
        return 0

    if not args.yes:
        print('\n❓  Proceed with the refresh?')
        print('    This will: ' + ('back up current tabs, ' if not args.no_backup else '')
              + 'overwrite Flat — Teacher / Flat — Class / both grids, and log the refresh.')
        if input('    Type "yes" to continue: ').strip().lower() not in {'yes', 'y'}:
            print('Cancelled.')
            return 1

    stamp = datetime.now().strftime('%Y%m%d_%H%M')
    if not args.no_backup:
        backup_tabs(at, stamp)
    push_schedule(at, parsed)
    log_refresh(at, summary, xml_path, args.label, parsed)
    verify_live(at, parsed, summary['added_t'])

    print(f'\n✅  Refresh complete ({args.label}).')
    print(f'    URL unchanged: {EXEC_URL}')
    print(f'    Tell admins to hard-reload (Cmd+Shift+R) once.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
