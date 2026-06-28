# Substitution Planner — Timetable Refresh Playbook

**Audience:** Future-me (or any agent — Hermes, Codex, Gemini) when the GDGPSD timetable changes.
**Goal:** Refresh the Substitution Planner with a new schedule in **≤ 5 minutes** with **zero deploys** and **zero URL changes**.

> **TL;DR:**
> 1. Drop new `asctt2012*.xml` into `~/Downloads/`.
> 2. `cd ~/Developer/gdgpsd/substitution_webapp && python3 refresh_timetable.py`
> 3. Review the diff → type `yes` → done. The live planner picks up changes on next page reload.

---

## 1. WHAT THE USER MUST SEND

| Priority | File | What I extract |
|---|---|---|
| **MUST** | `asctt2012*.xml` (ASC TimeTables export → File → Export → XML) | Periods, teachers, classes, subjects, lessons, cards (the full schedule) |
| OPTIONAL | `contracts*.xlsx` | Cross-check only. Has teacher/class/subject metadata. Not strictly needed since XML is canonical. |
| OPTIONAL | Effective-from date (e.g. "W.E.F. 19 May 2026") | Just labels the refresh log entry. Defaults to today's date. |

**Drop in:** `~/Downloads/` — the script auto-picks the most recent `asctt2012*.xml` by mtime.

## 2. QUESTIONS TO ASK (before running)

Only ask these if the user hasn't volunteered the answers:

| Q | Why | When to ask |
|---|---|---|
| "Has the period count changed? (Currently 8 periods, 7:40-13:30)" | If yes, `Index.html` PERIODS array + `_DATA.periodTimes` need updating + redeploy | If user mentions schedule restructuring |
| "Is Saturday still a full day?" | Currently Mon-Sat all-8. If half-day Sat changes things. | Only if user says "schedule structure changed" |
| "Are there any in-flight drafts in Daily Drafts I should preserve?" | If yes, snapshot Daily Drafts tab before push so we can recover if needed | Always — costs 1 sec to check |
| "Should I also update the PT-1 form's TEACHER_DATA in lockstep?" | That's a separate Apps Script project — they can drift if not updated together | If teacher list changed |

Don't ask "do you want me to push?" up front — the script's diff report will let the user confirm with full information.

## 3. TIME ESTIMATE

| Scenario | Time | Why |
|---|---|---|
| **Happy path** (XML only, no structural changes) | **5 min** | Drop file → run script → review diff → confirm → done |
| With cross-check via xlsx | 8 min | Same + manual spot-check vs Excel teacher list |
| Period/day structural change | 30 min | Bump `PERIODS`/`DAYS` in `Index.html`, redeploy via `redeploy_subapp.py`, then refresh |
| Plus PT-1 form sync | +10 min | Update `TEACHER_DATA` in `~/Developer/gdgpsd/pt_syllabus_webapp/Code.gs` + redeploy |

## 4. THE ONE-COMMAND HAPPY PATH

```bash
cd ~/Developer/gdgpsd/substitution_webapp
python3 refresh_timetable.py --dry-run     # diff only — always run this first
python3 refresh_timetable.py               # the real thing; prompts for confirmation
```

Common flags:
```bash
python3 refresh_timetable.py --xml ~/Downloads/asctt2012-v13.xml  # specific file
python3 refresh_timetable.py --label "W.E.F. 19 May 2026"         # custom label in log
python3 refresh_timetable.py --yes                                # skip confirm (automation)
python3 refresh_timetable.py --no-backup                          # skip backup tabs (faster, risky)
```

## 5. WHAT THE SCRIPT DOES (read this so you understand the diff output)

1. **Picks the latest** `asctt2012*.xml` in `~/Downloads/` (or `--xml` if given)
2. **Parses XML:**
   - `<periods>` → period number + start/end times
   - `<subjects>` / `<teachers>` / `<classes>` → uses `short` attribute first, falls back to `name`
   - `<lessons>` → subject + classes + teachers (resolved from IDs)
   - `<cards>` → for each card, expands the days bitmap (`100000` = Monday) into one flat row per (day × teacher), with class label being " / "-joined if multi-class
   - Filters out non-pedagogical "Floor" / supervision classes
3. **Reads current sheet** (`Flat — Teacher` tab) via Sheets API (OAuth token at `~/.hermes/google_token.json`, 95 scopes)
4. **Diffs:**
   - Teacher set: added / removed
   - Class set: added / removed
   - Subject set: added / removed
   - Schedule cells keyed by `(teacher, day, period)`: added / removed / changed
5. **Shows a report** like:
   ```
   Teachers:  current=56  new=61  added=5  removed=0
   Classes:   current=34  new=30  added=0  removed=4
   Schedule cells:  current=1554  new=1410  added=0  removed=144  changed=0
   + Teachers added: Mr. Rajesh, Ms. Arpana, Ms. Divya, Ms. Maria, Ms. Yanki
   − Classes removed: 1st Floor, 2nd Floor, 3rd Floor, IX A / IX B / IX C
   ```
6. **On confirmation:**
   - Duplicates `Flat — Teacher`, `Flat — Class`, both grids, **`Daily Drafts`**, and **`Substitution Log`** to `Backup_YYYYMMDD_HHMM_*` tabs (Daily Drafts isn't overwritten but a schedule change can invalidate in-progress drafts — backup is for manual recovery)
   - Clears the 4 schedule tabs and writes new values
   - Appends one row to `Refresh History` tab with label, XML filename, counts, diff summary
   - Re-fetches the live `/exec` URL and grep for the actual names of newly-added teachers — fails the verification if any are missing from served HTML

## ⚠ TESTED STATE OF THE SCRIPT

| Path | Status |
|---|---|
| Parser (XML → flat rows) | ✅ Dry-run tested on real `asctt2012 (1).xml` — output verified |
| Diff (current vs new) | ✅ Dry-run tested — produces sane added/removed/changed counts |
| `--dry-run` flag | ✅ Works |
| Write path (`backup_tabs`, `push_schedule`, `log_refresh`) | ⚠ **First real refresh is the integration test** — these call live Sheets API and have not been exercised yet |
| `verify_live` (added-teacher name grep) | ⚠ Logic is right but depends on Apps Script cache TTL; may need a retry-after-60s |

→ When running the first real refresh: **start with `--dry-run`** to validate the diff, then run real and watch the output. If something fails mid-way, the backup tabs let you restore manually.

## 6. HOW THIS IS BETTER THAN THE FIRST BUILD (2026-05-11)

| First build hit | Now mitigated by |
|---|---|
| 30+ min ad-hoc XML parser writing | Parser baked into `refresh_timetable.py`, tested |
| OCR'd PDFs as "backup verification" — wasted ~2 hours | Pure XML parsing — no OCR needed; the XML *is* the source of truth |
| No backup of current sheet before overwrite | Script duplicates all 4 tabs to `Backup_YYYYMMDD_HHMM_*` before pushing |
| Manual diff (eyeballed teacher lists) | Automated diff with explicit added/removed/changed counts |
| Token expired mid-deploy | Script refreshes OAuth token at the start of every run |
| No audit trail | `Refresh History` tab logs every refresh with label + diff summary |
| Forgot to update PT-1 form's TEACHER_DATA in sync | This playbook reminds to ask; future work: extend script with `--also-pt1` flag |
| Uppercase MATHS/BIOLOGY breakage | Parser uses `short` attribute first (Maths/Bio), matches existing sheet convention |
| Multi-class lessons exploded into duplicate rows that overwrote each other in `schedule[teacher][day][period]` | Multi-class lessons emit ONE flat-teacher row with " / "-joined class label, preserving the legacy notation |
| No way to undo a bad push | Restore from `Backup_*` tabs (manually copy back) |

## 7. ROLLBACK PROCEDURE

If a refresh is bad (wrong schedule pushed, planner shows wrong data):

1. Open the Timetable Sheet
2. Find the latest `Backup_YYYYMMDD_HHMM_flat_teacher` tab — rename to `Flat — Teacher` (after deleting/renaming the current one)
3. Same for `flat_class`, `tw_grid`, `cw_grid`
4. Reload the planner — it picks up the restored data instantly

Alternatively, if you have the old XML:
```bash
python3 refresh_timetable.py --xml ~/Downloads/asctt2012-old.xml --label "ROLLBACK"
```

## 8. WHEN TO DO A FULL REDEPLOY (not just a refresh)

The `refresh_timetable.py` script handles **data changes only**. You need a real redeploy (`/tmp/redeploy_subapp.py` or the skill's `deploy.py.template`) when:

- **Period count changes** (8 → 9 periods, etc.) — `PERIODS` array + `_DATA.periodTimes` in `Index.html` need updating
- **Day count changes** (Mon-Sat → Mon-Fri, or adding Sunday) — `DAYS` array
- **Scoring weights need tuning** — `renderModalBody` + `autoFill` in `Index.html`
- **Print memo template changes** — `buildPrintMemo` in `Index.html`
- **Code.gs functions added / removed** — backend changes

For pure schedule data changes (which classes meet when, which teacher teaches what), `refresh_timetable.py` is enough.

## 9. POST-REFRESH CHECKLIST

After the script completes, verify:

- [ ] Open `https://script.google.com/macros/s/AKfycbyiIvckjAKlunlEGkRZwVOik2wA3-3M7sSIEcNgZoLqGS-oC5FSZqRzcOZnPgDruqu2_A/exec` in browser
- [ ] Hard-reload once (Cmd+Shift+R)
- [ ] Dropdown "— Add absent teacher —" shows the new teacher count (61 currently)
- [ ] Pick any added teacher → confirm their schedule shows in slots
- [ ] Pick any teacher who taught the changed multi-class lesson → confirm "IX A / IX B / IX C" displays correctly
- [ ] Check Daily Drafts tab → existing drafts for the next school day still load (with possibly some PENDING slots if class assignments shifted)

Tell admins: "Schedule refreshed for [label]. Hard-reload (Cmd+Shift+R) once to see new teachers."

## 10. FILE INVENTORY

| Path | Role |
|---|---|
| `~/Developer/gdgpsd/substitution_webapp/Code.gs` | Apps Script backend (no change needed for refresh) |
| `~/Developer/gdgpsd/substitution_webapp/Index.html` | Frontend (no change needed for refresh) |
| `~/Developer/gdgpsd/substitution_webapp/refresh_timetable.py` | **The refresh script — this playbook's hero** |
| `~/Developer/gdgpsd/substitution_webapp/REFRESH-PLAYBOOK.md` | This file |
| `~/.hermes/google_token.json` | OAuth token (95 scopes, includes spreadsheets) |
| `~/.mempalace/gdgpsd_data/teacher_subject_class_v12.json` | Teacher emails + canonical subject→class map (for PT-1 form sync) |
| `~/.claude/skills/substitution-planner/` | Reusable skill (for setting up the planner at a new school) |
| Timetable Sheet | https://docs.google.com/spreadsheets/d/1RFzdymdxtn1_DjhL0n8_7rn68WNHPT90DHLrEo1qtrM/edit |
| Live planner | https://script.google.com/macros/s/AKfycbyiIvckjAKlunlEGkRZwVOik2wA3-3M7sSIEcNgZoLqGS-oC5FSZqRzcOZnPgDruqu2_A/exec |

## 11. BACKLOG (improvements for v2 of the playbook)

- [ ] `--also-pt1` flag to sync the PT-1 form's `TEACHER_DATA` in lockstep
- [ ] `--email-subs` flag to email teachers about substitution arrangements (needs SMTP / Gmail API)
- [ ] Auto-detect period count change from XML and prompt for redeploy
- [ ] Slack/Telegram notification on refresh complete
- [ ] Compare against `~/.mempalace/gdgpsd_data/teacher_subject_class_v12.json` and warn if drift exists
- [ ] Web UI for the refresh (drag-drop XML in browser instead of CLI)
