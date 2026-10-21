# BodyTrack: project state

The single source of truth for the project. Every new session starts here, and every decision is updated here.
Last updated: 21.10.2026. Replaces the old spec doc in Claude Docs and everything said in earlier chats.

> No personal data in this file or in the repo (public). Real numbers live only on the phone and in the private backup file.

## 1. What we're building
A private iPhone app (PWA on GitHub Pages) for weekly body tracking by a fitness coach.
One weekly check-in, then a "פסק דין" (verdict) screen based on the trend, plus an analytics screen for experts.
All data is stored only on the phone. Hebrew, RTL.

**Out of scope (don't bring back):** characters, game worlds, pixel art, animations, the pets, the daily ritual, an AI coach in chat (belongs to Training OS), the motivational/"voice" line on the verdict screen.

## 2. Product decisions (approved)
- **Weigh-ins:** about once a week. The trend = average of the last 4 weigh-ins. Rate = slope of the average over the last 4 weeks, in kg/week.
- **Stuck:** a change of less than 0.2 kg/week (shown as a band on the scale).
- **Colors:** green only for movement toward the goal, red only away from it, always with an arrow and a Hebrew word. Nothing else is green or red.
- **Numbers:** always LTR with the sign on the left (−0.30, +1.0), real minus sign U+2212.
- **Goal direction:** per metric (weight, and each circumference site), derived from the phase (cut/bulk/maintenance).
- **Verdict screen:** numbers and trend only, no voice line.
- **Photos:** stored only on the phone; on-device alignment. Parked until phase 3 (prototype in `lab/photos`).

## 3. Phases
| Phase | Contents | Status |
|---|---|---|
| 0. Foundations | Installed shell, offline, versioned data layer (IndexedDB), backup/restore to a file, import of historical data | **Done** (21.10: installed on iPhone, data restored, first backup saved) |
| 1. Weekly loop | Design system (Swiss Lab), check-in, trend engine, verdict screen, analytics screen, goals and directions, history with edit/delete/undo | **Next** (first: build the agent team) |
| 2. Voice | Coaching voice line (if at all, not on the verdict screen) | Deferred |
| 3. Photos | Camera with ghost overlay, alignment, comparison, backup to gallery | Parked |
| 4. Later | Training OS connection, timelapse export | TBD |

### Phase 1: spec
- **Check-in:** weight (required, defaults to the previous weigh-in), circumferences (previous value next to each site, can skip), tag (normal / sick / vacation / event) and a one-line note. Goal: under 2 minutes. Separate quick weigh-in without a full check-in.
- **Verdict:** the verdict word + arrow, weekly rate, scale with the stuck band; average of 4 weigh-ins / change vs. previous month / today's weigh-in; weight chart (month / 3 months / all) with dots + average line; circumferences vs. the last measurement; "סיום" button. Fewer than 4 weigh-ins → show what exists and say it's too early to judge.
- **Analytics:** trend vs. weigh-ins with phase bands; rate in kg and % of body weight vs. the cut target range (0.5–1%); weekly bars of the change in the trend; volatility (with "אין מספיק נתונים" empty state), weigh-ins per week, longest gap; circumference table (since phase start and since last time); waist-to-hip ratio, cm of waist per kg; recomposition indicator; goal projection; records. Estimated body fat (US Navy) only if height is entered, and labeled as an estimate.
- **Every number is computed** in pure functions with tests. Never write a number by hand.

## 4. Design system: Swiss Lab Report (chosen 21.10.2026)
Reference: `docs/design/swiss-verdict.html`, `docs/design/swiss-analytics.html` (sample data).
- **Feel:** a lab report. Black rules, numbered figures and tables ("איור 1", "טבלה 1"), lots of order, no decoration.
- **Colors:** background `#F7F7F5`, ink `#111`, muted `#5E5E5A`, hairline `#D2D2CC`, good `#13703F`, bad `#B3261E`.
- **Type:** Heebo (400/500/700/800/900), self-hosted under `fonts/` (no Google Fonts link in the app), tabular digits. Hero rate 118px/800. Minimum 12px everywhere, including charts.
- **Components:** heading with a 3px rule; verdict word + hero number; centre-zero LTR scale −1..+1 with the ±0.2 band; 3-cell grid with hairline dividers; figure with range control; ruled table; dark full-width button.
- **Charts:** honest. Axes labeled, same scale, SVG drawn at its real width (no shrinking text below 12px).
- Open: a dark mode for the same language (not designed yet).

## 5. Architecture
- Plain JS modules, no build step. Three layers: data (`js/db.js`), logic (pure functions), screens.
- Versioned data schema (`SCHEMA`, `MIGRATIONS`); every change converts existing data, never deletes it.
- Service worker network-first, version-numbered cache.
- Backup: JSON via the share sheet to Files/iCloud; reminder after 30 days. Restore: merge or replace, validated before writing.
- Records: weigh-ins, measurements, check-ins, goals, settings (meta).
- Measurement sites (`js/model.js`): מותניים (טבור), מותן, ישבן, חזה, כתפיים, יד קדמית רפוי/לא רפוי, ירך, שוק, צוואר, פרק כף יד.

## 6. How we work (permanent rules)
1. Each new phase opens with a **tool scout** (skills/plugins/connectors), with a safety, users and cost check.
2. Before any proposal is shown to the user, it passes a **review by an independent expert** matching the phase (design → design critic, code → code review), fixes are applied, and only then is it presented.
3. No paid tools without asking. Prefer free.
4. Questions as multiple-choice options.
5. Do everything yourself; don't hand the user technical steps unless there's no other way (passwords, GitHub settings).
6. Every decision is updated here in `docs/PROJECT.md` in the same session.
7. External tools (Stitch etc.) get sample data only.
8. Commits as `Rizi-cmd@users.noreply.github.com`.

## 6a. The team (`.claude/agents/`)
| Agent | Role | Model |
|---|---|---|
| ui-designer | Screen/component spec, mockups under docs/design/ (sample data) | Opus |
| frontend-dev | Builds screens in plain JS, owns the Playwright smoke test (WebKit, 440x956) | Sonnet |
| data-engineer | Schema, migrations, backup/restore, pure functions + node:test | Sonnet |
| fitness-analyst | Exact metric definitions; verify mode checks the code against them | Opus |
| design-critic | The review gate: design, UI QA, code review. Read-only | Opus |
| privacy-guardian | Before every commit/push and any new tool or network call. Read-only | Sonnet |
| hebrew-writer | All Hebrew the owner reads, everyday speech. Read-only | Opus |

Routing (agents can't call each other; the main agent routes and is the only one that edits this file):
- Design → ui-designer → hebrew-writer → design-critic → owner.
- Code → frontend-dev / data-engineer → design-critic → privacy-guardian → commit.
- Metrics → fitness-analyst (define) → data-engineer (build + tests) → fresh fitness-analyst (verify) → design-critic.
- Phase 1 first task: QA setup (`tests/`, invented fixture, WebKit smoke test).

## 6b. Open items
- Goal direction: PROJECT.md says derived from the phase; `js/model.js` hard-codes it per site. fitness-analyst defines, data-engineer migrates.
- `lab/photos` loads outside scripts (jsDelivr, Google) on the same address as the app. Low risk (the home-screen app's storage is separate from Safari), but to be resolved.

## 7. Decisions log
- 20.10 PWA instead of a Claude page. Pixel world and pets cancelled. Weekly check-in.
- 20.10 No voice line on the verdict screen. Analytics screen added to phase 1.
- 21.10 Stitch produced 6 directions → after two rounds of expert review, **Swiss Lab** was chosen.
- 21.10 Import file rebuilt from the notes (screenshots), checked by an independent reviewer and loaded locally without errors. Data rule: a label that doesn't match a site → map to the site with the closest values; if unclear, drop it.
- 21.10 Phase 0 closed: app installed on the iPhone from the home screen, historical data restored, first backup in iCloud Drive. Security check passed (only the owner's commits, no outside network calls in the app, live site matches the repo).
- 21.10 Agent team created (7 agents), reviewed independently and fixed. Heebo will be self-hosted. Wrist site name = "פרק כף יד" (as in the source notes).
