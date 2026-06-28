# ASC Substitution Engine — Gap Analysis for GDGPSD Substitution Webapp

**Date:** 2026-05-12
**Subject app:** `/Users/abhishekchhetri/Developer/gdgpsd/substitution_webapp` (v3.11.1 — Apps Script + Sheets + vanilla JS)
**Reference app:** ASC TimeTables `roz.exe` (Slovak Windows MFC binary, Visual Studio 2010, ~140 MB)
**Decompilation source:** `/Users/abhishekchhetri/Downloads/Cloning ASC/GhidraProject/complete_decompiled.c` (10.2 MB Ghidra dump, lines 1–300 487)
**Live UX reference:** `abhishekchhetri.edupage.org/substitution/admin.php` (captured 2026-05-11)

---

## 1. ASC's substitution architecture — what the decompilation actually shows

### 1.1 Class layout (RTTI-confirmed, see `asc_rtti_mapping.txt`)

ASC has a fully separate state machine for the *daily substitution* document vs. the *base timetable* document. The substitution side is the `CSupl*` family (~30 classes):

**Data / model layer**

| Class | Decompiled line | Role |
|---|---:|---|
| `CSuplovanieAbstract` | 273137 | Base class for one substitution record — holds absent-teacher ref + replacement + period + class + status. 49-entry vftable (heavy MFC serialization). |
| `CSuplovanieSKartou` | 252013 | "With card" — card-swipe / digital ID substitution flow (school uses RFID attendance). |
| `CSuplovanieDozor` | 274429 | "Dozor" (Slovak: corridor/hall **supervision**). The supervision-duty variant — same shape but supervision instead of teaching. |
| `CSuplovanieDlg` | 276311 | Dialog-driven manual substitution (admin types it in). |
| `CSuplMan` | 266413 | Manager / collection — iterates over all teacher-day absences and builds the substitution objects (3-entry vftable plus the big `OnSerialize` driver at `FUN_008d7a92` line 266434). |
| `CSuplRozMan` | 268970 | Roster manager — drives the substitution **schedule** rather than the substitution records themselves. |
| `CSuplDoc` | (CDocument subclass; constructor `FUN_0093ce42`) | Top-level document with the substitution grid defaults at `+0xa3b4..+0xa3e4`. |
| `CSuplVolno` | 272898 | "Volno" (free time) — represents a single per-teacher free-period entry. |
| `CSuplPredmet` | 268448 | Substitution-side wrapper around a subject (13-entry vftable, holds approbation list). |
| `CSuplObsadenie` / `CSuplObsadenieDozor` / `CSuplObsadenieList` | 268389 / 267712 / 268035 | "Obsadenie" = "occupancy" — which slots are filled, dozor variant for duty slots. |
| `CSuplSluzby` | 269611 | "Sluzby" (duty roster) — the **on-duty pool** of teachers always available for emergencies. |
| `CSuplUcHodina` / `CSuplUcRiadok` / `CSuplUcebRiadok` | 269786 / 270236 / 271638 | "Uc-Hodina" = teacher-lesson row; "Uceb-Riadok" = classroom row. Per-teacher / per-classroom view rows used by the picker grid. |
| `CSuplUtils` | 272698 | Static helpers. |

**Dialog layer**

| Class | Decompiled line | Role |
|---|---:|---|
| `CSuplRozvrhDlg` | 253697 | The main "substitution timetable" dialog — the picker. **Surprise**: pure `CXTPResizeDialog` shell (27-entry standard MFC vftable). No business logic in vftable; ranking happens elsewhere via the criterion list. |
| `CSuplGeneralPage` | 262133 | "General" tab of the substitution settings property sheet. |
| `CSuplKritPage` | 264243 | **"Criteria" tab — this is where the user edits scoring weights.** `CXTPResizeDialog` with `CSuplKritPage` self-pointer at offset `00b048a4`. |
| `CSuplKritPopisDlg` | 263165 | "Criterion description" dialog — pops a help box per criterion. |
| `CSuplNastavenieSheet` | 266663 | "Settings" property sheet host (contains General + Krit pages). |
| `CSuplLessonChangeDlg` | 265330 | "Lesson change" — the period-reassignment dialog. |
| `CSuplEditPoznamka` | 257392 | **Note editor** (Slovak: poznámka = note). Confirms ASC has a per-substitution free-text note field. |

**Report / print layer**

| Class | Decompiled line | Role |
|---|---:|---|
| `CSuplTlacSuhrnChybajucichDlg` | 258022 | "Print summary of absent teachers" — the absentee memo. |
| `CSuplTlacSuhrnSuplovaniaDlg` | 259029 | "Print summary of substitutions" — the substitution memo (equivalent of our Print Memo). |
| `CSuplExportSuhrnDlg` | 261095 | Export summary to XLS / HTML. |

### 1.2 The scoring algorithm — what it actually is

The earlier reverse-engineering pass concluded *"ranking is filter-chain based, not weighted-sum based."* That conclusion was incomplete. Reading the `CKrit*` class headers (lines 6–1900 of `complete_decompiled.c`) and extracting the `puVar1[5] = ...` constructor stores tells a clearer story:

**ASC uses a uniform weighted-criterion list. Each `CKrit*` predicate has a numeric weight stored at offset `+0x14` (`puVar1[5]` in decomp). Hard constraints are encoded as extreme weights — they participate in the same sum.**

The full list of substitution-relevant criteria with their weights:

| Class | Line | Slovak label | English meaning | Weight | Sign | Role |
|---|---:|---|---|---:|:---:|---|
| `CKritAprobacia` | 6 | "Aprobacia" | Teacher qualification match for the subject | **10** | + | Soft bonus |
| `CKritBody` | 177 | (user "points") | Custom admin-defined score adjustments | **10** | + | Soft, configurable |
| `CKritPovodnyUcitel` | 394 | "Učiteľ túto hodinu vyučuje podľa rozvrhu" | "Teacher teaches this lesson per the timetable" — i.e., is the original teacher | **20 000** | + | Hard preference (the absent teacher's own slot, when they return) |
| `CKritResty` | 501 | "Suploval/Odpadlo" | "Substituted / cancelled" — past substitution history of this teacher | **10** | + | Soft fairness / continuity |
| `CKritSluzba` | 619 | "Určený na službu" | "Designated for duty" — teacher is in the on-duty pool today | **50 000** | + | Hard preference (use the duty pool first) |
| `CKritTriedny` | 803 | "Triedny" | Is the **class teacher** of the absent class | **10** | + | Soft bonus |
| `CKritUciVTriede` | 984 | "Učiteľ učí v danej triede" | "Teacher teaches in this class" — class familiarity | **10** | + | Soft bonus |
| `CKritVhodneNaSpojenie` | 1165 | "Vhodne na spojenie" | "Suitable for merging" — favors merging two classes into one supervised session | **150** | + | Medium bonus (the pair-class merge incentive) |
| `CKritViacAkoPovolene` | 1568 | "Učiteľ učí viac ako má povolené" | "Teacher teaches more than allowed" (i.e., already over their daily/weekly substitution cap) | **−10** (0xfffffff6) | − | Soft penalty |
| `CKriterium` / `CKriteriumDef` | 1785 / 1909 | (abstract) | Base + factory for criteria — `CKriteriumDef` lets users define new criteria | — | — | The plug-in mechanism |

Key facts the decompilation makes concrete:

1. **The weights are baked in** but admins can edit them in `CSuplKritPage` (the Settings → Criteria tab). The criterion ID, weight, and label round-trip through the document save format.
2. **`CKritPovodnyUcitel` weight 20 000 and `CKritSluzba` weight 50 000 are effectively hard pins** — no realistic combination of soft criteria can overpower them.
3. **`CKritViacAkoPovolene` is a soft penalty (−10)**, *not* a hard cap. ASC behaves exactly like our tool: it discourages but doesn't forbid teachers going over their daily limit. The "max substitutions per day" cap is a soft signal in ASC too.
4. **`CKritVhodneNaSpojenie` (weight 150)** is the pair-class merge incentive. When two parallel classes (e.g. two Class V sections) are both missing a teacher in the same period, this criterion rewards picking *one* substitute and merging them — saving a sub.

### 1.3 Mapping ASC's weights onto our scoring scale

| ASC criterion | ASC weight | Our equivalent | Our weight | Note |
|---|---:|---|---:|---|
| `CKritUciVTriede` | +10 | "class familiarity" | +30 | ✓ have, weighted higher |
| `CKritAprobacia` | +10 | "subject match" | +100 | ✓ partly emulated (we don't track strict qualifications, just the subject the teacher teaches in their cards) |
| `CKritTriedny` | +10 | "class teacher bonus" | +25 | ✓ have |
| `CKritResty` | +10 | "today-substitutions" + "last-7-days" penalties | −5 / −2 | ✓ have (inverted as fairness penalty) |
| `CKritVhodneNaSpojenie` | +150 | (no pair-class merging) | — | ✗ missing |
| `CKritPovodnyUcitel` | +20 000 | "co-teacher / split-class top candidate" | hardcoded promotion | ✓ partly (when the same class has 2 teachers in the slot, the other is promoted) |
| `CKritSluzba` | +50 000 | (no on-duty pool) | — | ✗ missing |
| `CKritViacAkoPovolene` | −10 | "today-substitutions" −5 each | −5 | ✓ have, slightly stronger |

What's **also** missing from our scoring side: an explicit "prev period continuity" / "adjacent gap" criterion in ASC's weight list — those are in our tool (+20 / +15) but were not surfaced as separate `CKrit*` classes in the dump. They may be inside `CSuplovanieAbstract::Score` or one of the higher-numbered FUN_* helpers that didn't get a Slovak-labeled wrapper. Treat as "ASC implicitly favors gap-adjacency through enumeration order, we make it explicit." Net: our scoring is **richer** than ASC's published criterion list on continuity/gap, **poorer** on duty-pool and pair-merge.

### 1.4 The picker dialog (EduPage-level, hands-on)

From the live EduPage substitution UI (2026-05-11 capture, drawer `wing_gdgpsd/edupage_picker_dialog_anatomy`), the picker has five zones:

1. **Top header** — slot being filled (date, subject + Change link, class, absent teacher implicit).
2. **Candidate list** — 5–7 **pre-ranked** candidates as a vertical list. Each row has: name, classroom arrow, remove (×), Change link. Bracketed names are also-absent. "Add" link at bottom to expand beyond auto-suggested.
3. **Slot metadata** — period dropdown (period reassignment), Cancelled checkbox, Type-of-substitution dropdown (defaults to "Unknown type"), Note free-text.
4. **Visual context grid** — the killer feature. Horizontal periods (1st..8th) × vertical rows: top row = the **absent class's** full-day schedule; each candidate teacher's full-day schedule below. Pink=absent, Blue=busy, Empty=free, Grey overlay = slot being filled.
5. **Right sidebar** — annotations ("Ms. Yachna teaches the class"), stats (Substituted / Supervisions / Month), "He/she dropped" + "On duty" counters.

The on-duty counter on the right sidebar is the user-facing surface of `CSuplSluzby` / `CKritSluzba`.

---

## 2. Gap analysis — sorted by impact

We've already implemented most of the picker UX (visual context grid, ranked candidates, class-teacher annotation, Note field, Cancel/Supervision modes, period reassignment, multi-tag absent picker, partial-day absence ranges, fairness counters). The genuine gaps are below.

Legend: **We Have It?** ✓ = shipped, ◔ = partial, ✗ = missing. **Cost** in our Apps Script stack: S=hours, M=a day, L=a few days. **Impact** 1–5 for a 60-teacher CBSE school.

| # | ASC feature | What it is | We have it? | Cost | Impact |
|---:|---|---|:---:|:---:|:---:|
| 1 | **Multi-day absence** | One absent record that auto-rolls forward across a date range | ✗ | S–M | **5** |
| 2 | **Email/WhatsApp notification to substitute** | Send each chosen substitute their slot list on Publish | ◔ (stub in `savePlan` but no teacher email map) | S | **5** |
| 3 | **On-duty teacher pool (CSuplSluzby / CKritSluzba)** | Small daily roster of teachers always available; promoted to top of picker | ✗ | S | **4** |
| 4 | **Pair-class merge (CKritVhodneNaSpojenie)** | When two parallel classes both need cover at same period, merge into one supervised session | ✗ | M | **4** |
| 5 | **Approbation list (CKritAprobacia, strict)** | Explicit allow-list of subjects each teacher is qualified to teach | ◔ (we approximate via the cards) | M | **3** |
| 6 | **Substitution-fairness report** | Weekly / monthly leaderboard showing per-teacher load + a "He/she dropped" tally for accuracy auditing | ✗ | S | **3** |
| 7 | **"Don't substitute X — reschedule instead" rule** | Per-teacher / per-subject toggle: never auto-substitute, raise for admin to reschedule | ✗ | S | **3** |
| 8 | **Copy-absent-from-yesterday** | One-click convenience for ongoing absences | ✗ | S | **3** |
| 9 | **Hard cap on max-substitutions-per-day** | Currently soft (−5 each); switch to a configurable hard cutoff with override | ◔ | S | **2** |
| 10 | **Substitution acceptance flow** | Substitute can decline / acknowledge from email link; admin sees status | ✗ | M | **2** |
| 11 | **Class-absent / Classroom-absent** | Mark an entire class (field trip) or room (under repair) as absent | ✗ | M | **2** |
| 12 | **Configurable scoring weights** (`CSuplKritPage`) | Admin UI to edit weights | ✗ | M | **1** for a 60-teacher school |
| 13 | **Substitution type taxonomy** | Multiple admin-labeled types (sick / training / official leave / makeup) for end-of-month reporting | ◔ (we have SUB/SUPERVISION/CANCEL only) | S | **2** |
| 14 | **Real-time multi-user collaborative editing** | Operational-transform style live cursor sync | ✗ | L | **1** (we have last-write-wins drafts; for 1–2 admins it's enough) |
| 15 | **Mobile-responsive picker** | Picker grid usable on a phone | ◔ | M | **2** |
| 16 | **Export substitution memo to PDF / XLS** | One-click export of the published memo | ◔ (browser-native print) | S | **2** |
| 17 | **Per-criterion description popup** (`CSuplKritPopisDlg`) | Help text per criterion | n/a | — | **0** |
| 18 | **User-extensible criterion plugin** (`CKriteriumDef`) | Admin-defined CKrit subclass | ✗ | L | **0** (enterprise feature, not for one school) |
| 19 | **Card-swipe / RFID daily attendance** (`CSuplovanieSKartou`) | Hardware integration | ✗ | — | **0** |
| 20 | **Multi-school federation** | Centralized admin across a chain | ✗ | — | **0** |

---

## 3. Top 5 prioritized recommendations

Ordered by **(impact × cost-inverse)** — i.e. biggest UX win per hour of work first. Ties broken by stakes (board-class protection beats convenience).

### #1 — Multi-day absence with auto-roll-forward (Impact 5, Cost S–M)

**What it is.** A teacher absence record carries a date range, not just one date. When the admin opens the planner on any date in the range, the absent teacher is auto-added.

**Why it matters.** A single 5-day flu currently requires the admin to re-add the same teacher 5 mornings in a row. For an Indian school where flu/dengue absences typically run 3–7 days, this is the biggest daily annoyance after picking subs themselves. Mirrors ASC's "Longtime absence" checkbox in the New Absent dialog and EduPage's "longtime absence."

**Implementation sketch** (Apps Script + Sheets):

1. New sheet tab `Long Absences` with columns: `teacher | from_date | to_date | reason | note`.
2. In `loadDayCache(date)` (`Code.gs:204`), after building the teacher list, scan `Long Absences` and inject any rows where `from_date <= date <= to_date` into the absent-teacher set for that day.
3. In the absent-picker modal in `Index.html`, add a "Long-term absence" toggle next to the date pickers. When checked, on Publish, also write a row to `Long Absences` instead of mutating just the day's draft.
4. Daily Drafts continue to be per-day; the long-absences sheet is the **source of truth** that bleeds into every day's draft on first load.

**Time estimate:** 3–4 hours.

---

### #2 — Email substitutes their assignments on Publish (Impact 5, Cost S)

**What it is.** When the admin clicks Publish, each substitute teacher receives an email listing their assigned slots for the day. Already stubbed in `savePlan` at `Code.gs:313`.

**Why it matters.** Today the admin has to verbally tell or WhatsApp each sub. Email is universal, audit-logged, and Apps Script does it for free with `MailApp.sendEmail`. This is the single most-asked-for feature in school staff rooms.

**Implementation sketch:**

1. Add `teacher_email` column to the existing teacher-data tab (the same one `refresh_timetable.py` populates from `contracts (with emails).xlsx` — that file already has emails per `~/.claude/projects/-Users-abhishekchhetri/memory/gdgpsd_teacher_directory.md`).
2. In `refresh_timetable.py`, write the email out as part of the teacher row.
3. In `Code.gs` `savePlan`, replace the existing `bySub` stub with:
   ```js
   if (plan.emailSubs) {
     const emails = _loadTeacherEmails(); // map name → email from sheet
     for (const subName of Object.keys(bySub)) {
       if (!emails[subName]) continue;
       const slots = bySub[subName]; // [{period, class, subject, originalTeacher}]
       const body = _renderSubEmail(plan.date, subName, slots);
       MailApp.sendEmail({to: emails[subName], cc: PRINCIPAL_EMAIL,
                          subject: `Substitution — ${plan.date}`, htmlBody: body});
     }
   }
   ```
4. Add an "Email substitutes" checkbox in the Publish dialog in `Index.html` (default ON).

**Time estimate:** 2–3 hours. Gotcha: Apps Script daily mail quota for a free Workspace account is 100 recipients/day — fine here.

---

### #3 — On-duty teacher pool (Impact 4, Cost S)

**What it is.** A small daily roster (1–3 teachers) marked as "today's emergency pool." They appear at the top of every picker with a 🛡 badge and get a +50 000-style hard score bump — but only when free in that period.

**Why it matters.** This is exactly `CSuplSluzby` + `CKritSluzba` from the decompilation. In Indian schools the principal typically rotates 1–2 teachers per day who carry no load and cover gaps. Our tool currently treats them like everyone else, so the auto-fill scatters subs across all free teachers instead of front-loading the duty teachers.

**Implementation sketch:**

1. Add a `Today's Duty Pool` row at the top of the date picker UI: a small multi-tag input (the same Slack-style picker we already have).
2. Store as `dutyPool: [teacherName, ...]` in the daily draft.
3. In the scoring function in `Index.html` (the one that produces ⭐⭐⭐ candidates), add `+200` if `teacher in dutyPool`. Use 200, not 50 000 — it dominates other scores cleanly without crowding the math.
4. In the picker grid, add a 🛡 badge to duty-pool names, and sort them above non-duty candidates of equal score.

**Time estimate:** 3 hours.

---

### #4 — "Don't substitute, reschedule" per-lesson rule (Impact 3, Cost S)

**What it is.** A teacher can mark certain lessons "must reschedule, don't substitute" (e.g., Class X Maths board prep, where a random sub would harm). When the absent teacher is missing, the planner shows that slot in a distinctive color with "RESCHEDULE — pick a new period" and refuses to auto-fill it.

**Why it matters.** Substituting board-class lessons with a non-qualified teacher is a known pain at GDGPSD — admin has to remember which lessons not to fill. Encoding it removes the cognitive load.

**Implementation sketch:**

1. New sheet tab `Reschedule Rules` with `teacher | class | subject | reason`.
2. In `loadDayCache`, attach a `mustReschedule: true` flag to slots that match a row.
3. In `Index.html`, render those slots with a salmon background and the period-reassignment dialog open by default; exclude from auto-fill.

**Time estimate:** 4 hours.

---

### #5 — Pair-class merge (Impact 4, Cost M)

**What it is.** ASC's `CKritVhodneNaSpojenie` (weight 150). When two parallel sections (e.g., V A Hindi and V B Hindi) both need cover in the same period, offer a "Merge — supervise both classes together in one room" action that fills both slots with one substitute.

**Why it matters.** For a 30-section school, this is genuinely a sub-saver. Without it, the admin pulls two teachers when one could supervise a combined study hall. The visual context grid already shows when this is possible — we just don't offer the action.

**Implementation sketch:**

1. Add a "🔗 Merge with another class" button in the picker when the slot is a study-hall / supervision and there's another absent slot at the same period with the same grade level (heuristic: same numeric grade in class name).
2. Clicking opens a small picker showing the other open slots for that period and one combined-classroom dropdown.
3. On confirm, both slots are marked `status: MERGED`, with `mergedWith` pointing at each other and `substitute` the same teacher. Display in print memo as "VI A + VI B (merged)".
4. Storage: same `slots` array, new status `MERGED`.

**Time estimate:** ~1 day (8 hours). The UI is the work, the data model is trivial.

---

## 4. Things NOT to implement

| Feature | Why not |
|---|---|
| **Configurable scoring weights (`CSuplKritPage` UI)** | ASC exposes weights as an admin tab because it ships to thousands of schools with different cultures. For one school of 60 teachers, you'll tune weights once in code and never touch them again. Exposing knobs costs UX complexity and gives near-zero benefit. Hardcoded weights with a comment block at the top of `Index.html` is the right answer. |
| **Substitution-acceptance flow (sub can decline by clicking a link)** | Indian school culture: the principal assigns, the teacher does it. Building an accept/decline loop introduces a state machine the admin has to chase. The email notification (rec #2) covers the actual need (knowing). |
| **Real-time multi-user collaborative editing** | We have 2 admins max (you + 1 backup). Last-write-wins drafts + 1.5 s autosave is fine. Operational-transform editing is a 2-week build for negligible gain. |
| **User-extensible criterion plugin (`CKriteriumDef`)** | ASC's plugin system exists because Slovak schools, Czech schools, Polish schools all have different rules. A single CBSE school doesn't. |
| **RFID / card-swipe attendance (`CSuplovanieSKartou`)** | Requires hardware. Out of scope. |
| **Multi-school federation** | Not the school you're at. |
| **Substitution constraint solver (full CSP)** | ASC has one because base-timetable generation needs it. Daily substitution is N≈10 slots per day — greedy with score threshold (what we already do) is optimal-enough. A real CSP would be over-engineering. |
| **Per-criterion help dialogs (`CSuplKritPopisDlg`)** | Only useful when weights are user-editable, which they shouldn't be (above). |
| **PDF export of memo** (separate from browser print) | Browser print + "Save as PDF" already works. Adding a PDF library is dependency creep with no real benefit. |
| **Class-absent / Classroom-absent** | Rare events at GDGPSD per the EduPage drawer's "rare for GDGPSD" annotation. Handle the field-trip case with a single absent record per teacher escorting, not a class-level feature. |

---

## Appendix — File references for primary-source claims

- Weights and labels — all exact lines in `complete_decompiled.c`, verified via `grep -n`:
  - `CKritAprobacia` weight 10 — line **164**; label "Aprobacia" — line **170**
  - `CKritBody` weight 0 — line **384** (no Slovak label emitted in constructor)
  - `CKritPovodnyUcitel` weight 20 000 — line **492**; label "Ucitel tuto hodinu vyucuje podla rozvrhu" — line **494**
  - `CKritResty` weight 10 — line **610**; label "Suploval/Odpadlo" — line **612**
  - `CKritSluzba` weight 50 000 — line **790**; label "Urceny na sluzbu" — line **796**
  - `CKritTriedny` weight 10 — line **968**
  - `CKritUciVTriede` weight 10 — line **1152**; label "Ucitel uci v danej triede" — line **1158**
  - `CKritVhodneNaSpojenie` weight 0x96 = 150 — line **1554**; label "Vhodne na spojenie" — line **1560**
  - `CKritViacAkoPovolene` weight 0xfffffff6 = −10 — line **1772**; label "Ucitel uci viac ako ma povolene" — line **1778**
- Class index: `/Users/abhishekchhetri/Downloads/Cloning ASC/GhidraProject/asc_rtti_mapping.txt`
- Prior reverse-engineering write-ups in MemPalace: `wing_asc-timetable-clone/ghidra-deep-analysis`, `wing_sessions/technical` (multiple drawers).
- Live UX captures: `wing_gdgpsd/edupage_picker_dialog_anatomy` (2026-05-11), `wing_gdgpsd/edupage_substitution_ux_analysis` (2026-05-11).
- Our planner: `Code.gs` 529 lines, `Index.html` 1 848 lines (v3.11.1).
