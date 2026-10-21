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
- **Weigh-ins:** irregular, whenever the owner weighs in (usually about weekly). The trend = average of the last 4 weigh-ins. Rate = slope of the average over the last 4 weeks, in kg/week. Exact definition: `docs/specs/trend-engine.md`.
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
| 1. Weekly loop | Design system (Swiss Lab), check-in, trend engine, verdict screen, analytics screen, goals and directions, history with edit/delete/undo | **In progress** (QA setup + 2 bug fixes done 21.10; trend engine built and verified 21.10; verdict screen built 21.10; check-in + quick weigh-in built 21.10; next: analytics screen) |
| 2. Voice | Coaching voice line (if at all, not on the verdict screen) | Deferred |
| 3. Photos | Camera with ghost overlay, alignment, comparison, backup to gallery | Parked |
| 4. Later | Training OS connection, timelapse export | TBD |

### Phase 1: spec
- **Check-in:** weight (required, defaults to the previous weigh-in), circumferences (previous value next to each site, can skip), tag (normal / sick / vacation / event) and a one-line note. Goal: under 2 minutes. Separate quick weigh-in without a full check-in.
- **Verdict:** the verdict word + arrow, weekly rate, scale with the stuck band; average of 4 weigh-ins / change vs. previous month / today's weigh-in; weight chart (month / 3 months / 6 months / all) with dots + average line; circumferences vs. the last measurement; "סיום" button. Fewer than 4 weigh-ins → show what exists and say it's too early to judge.
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
- Measurement sites (`js/model.js`): מותניים (טבור), מותן, ישבן, חזה, כתפיים, יד קדמית רפוי/מכווצת, ירך, שוק, צוואר, פרק כף יד.

## 6. How we work (permanent rules)
1. **Tool scout** only when the owner asks, or when a phase clearly needs a capability we don't have. Not automatically at every phase.
2. **Review:** by default the main agent reviews its own work against the spec and runs the tests. An independent agent is used only as listed in 6a ("Review by size") or when the owner asks. No extra manager agent: the main agent is the manager.
3. No paid tools without asking. Prefer free.
4. Questions as multiple-choice options, only when a real decision belongs to the owner.
5. Do everything yourself; don't hand the user technical steps unless there's no other way (passwords, GitHub settings).
6. Every decision is updated here in `docs/PROJECT.md` in the same session.
7. External tools (Stitch etc.) get sample data only.
8. Commits as `Rizi-cmd@users.noreply.github.com`.
9. **Data import:** map an unclear field name only when the match is reliable. If there is no safe match, keep the source data and report what wasn't imported. Never invent or silently drop data.

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

Default (owner decision 21.10, simplified): the main agent does the work itself. The agents stay available and are called only per the table below or when the owner asks. Agents can't call each other; the main agent routes and is the only one that edits this file.

Review by size:
| Change | Who reviews |
|---|---|
| Small: bug fix or tweak, under ~50 lines, no new screen | No agent. Main agent self-review + tests + CI. |
| New calculation | fitness-analyst defines; main agent builds with tests; one fitness-analyst verify at the end. |
| New screen or design | Main agent builds; design-critic once (hebrew-writer for the screen's text) before showing the owner. |
| Privacy | Basic check runs automatically in CI on every push (`npm run privacy`: no outside URLs in the app, no emails except noreply, no backup files outside fixtures, fixture marked invented). privacy-guardian agent only when adding a dependency, a network call, a new tool, or touching how data is stored or exported. |
Rule of thumb: no agent is launched twice for the same thing in one block; a re-review covers only what changed.

## 6b. Open items
- Restore count can overstate when two weigh-ins share a date without ids (pre-existing, low impact).
- Heebo not self-hosted yet (font downloads blocked in the work environment); app uses the system font. Mockups in `docs/design/` still link Google Fonts.
- Goal direction: PROJECT.md says derived from the phase; `js/model.js` hard-codes it per site. fitness-analyst defines, data-engineer migrates.
- `lab/photos` loads outside scripts (jsDelivr, Google) on the same address as the app. Low risk (the home-screen app's storage is separate from Safari), but to be resolved.

## 7. Decisions log
- 20.10 PWA instead of a Claude page. Pixel world and pets cancelled. Weekly check-in.
- 20.10 No voice line on the verdict screen. Analytics screen added to phase 1.
- 21.10 Stitch produced 6 directions → after two rounds of expert review, **Swiss Lab** was chosen.
- 21.10 Import file rebuilt from the notes (screenshots), checked by an independent reviewer and loaded locally without errors. Data rule: a label that doesn't match a site → map to the site with the closest values; if unclear, drop it.
- 21.10 Phase 0 closed: app installed on the iPhone from the home screen, historical data restored, first backup in iCloud Drive. Security check passed (only the owner's commits, no outside network calls in the app, live site matches the repo).
- 21.10 Agent team created (7 agents), reviewed independently and fixed. Heebo will be self-hosted. Wrist site name = "פרק כף יד" (as in the source notes).
- 21.10 Phase 1 tool scout: no new tools; existing Playwright and installed skills are enough (owner approved).
- 21.10 QA setup: `npm test` (node:test), Playwright smoke test (WebKit 440x956, invented fixture, offline reload, blocks outside hosts and console errors). WebKit can't be downloaded in the work environment, so CI runs it: GitHub Actions on every push to main (free for public repos, read-only, no secrets). Reviewed by design-critic and privacy-guardian, fixes applied. First CI run green in WebKit. "Offline" in the smoke test = stopping the local server (Playwright's setOffline breaks reloads in WebKit).
- 21.10 Bug fixes 0.1.1: `isISODate` rejects impossible days the same way on every engine; `validate()` can't throw on any JSON (fuzzed) and rejects bad lists, odd ids and years outside 1900–2100; restore errors show a message.
- 21.10 Trend engine spec v1 (`docs/specs/trend-engine.md`). Owner decisions: maintenance "holding" is green (staying put is the goal there); verdict and rate need 5 weigh-ins; the trend never resets after a gap.
- 21.10 Review by size adopted (owner): not every change goes through every agent; basic privacy check moved into CI. No manager agent.
- 21.10 Trend engine built: `js/trend.js` (pure functions) + `tests/trend.test.js` (all spec vectors V1–V9 and VF, edge cases; 42 tests pass). fitness-analyst verify: pass, V8 confirmed; 2 nits fixed (phase change flag ignores cut→cut; same-date phase records: later wins) and 2 coverage tests added. Open choices settled: `windowDates` = all weigh-ins feeding the rate (after a gap it can reach back more than 28 days, so the UI footnote must not say "last 4 weeks"); phase input = string or list of {from, phase}; `gap_reset` never produced.
- 21.10 Verdict screen 0.2.0 (Swiss Lab) is now the home screen: verdict word + arrow, rate, −1..+1 scale with stuck band, avg / change vs month / last weigh-in, weight chart (month / 3 months / 6 months / all), circumference table vs previous measurement (neutral ink), footnotes (provisional rate, phase changed, tagged weigh-in), phase picker, history, backup. All text and numbers from `js/report.js` + `js/trend.js` (58 tests). Reviewed by design-critic (7 fixes applied: phase picker undo, phase records validated on restore, circumference dates, off-scale cue, header shows today, hero fits 375pt, LTR date) and hebrew-writer (fixes applied). Phase rules: first pick covers all history; re-picking while only the first exists replaces it; later picks start today and same-day picks replace each other. Not done: Heebo self-hosting (downloads blocked in the work environment; iPhone system font used). The "סיום" button waits for the check-in screen.
- 21.10 Owner: phase choice moved next to the verdict ("לכיוון היעד" + phase button → sheet), phase removed from the header. Optional target weight per phase (`targetKg`, 30–300, for the goal projection on the analytics screen); same phase + new target only updates the current record. Site renamed "יד קדמית מכווצת" (id unchanged, data untouched). Next: check-in screen. Version 0.2.1.
- 21.10 Service worker fetches with `cache: 'no-cache'`: updates appeared late on the iPhone because GitHub Pages lets the browser cache files for 10 minutes. Version 0.2.2.
- 21.10 Owner: circumference table and history fold away (closed by default, tap the title to open). Version 0.2.3.
- 21.10 Owner: weighs in irregularly (no fixed day). Verdict always shows the trend between weigh-ins: if the last 28 days hold fewer than 3 averages, the rate uses the last 3 (or 2) averages whatever their dates, with a footnote giving the span in weeks. fitness-analyst verify: pass; flagged that after a break of months the colour may mislead; owner chose to keep the full verdict (green/red) always. New line under the numbers: days since last weigh-in + average gap between weigh-ins over all history (owner's choice: all history). Nothing is ever auto-filled (no invented weigh-ins). Version 0.3.0.
- 21.10 Tool scout (owner asked): plugin directory searched; nothing new adopted (Playwright MCP, E2E generator, a11y checkers duplicate what we have; Axe/Kobiton are remote/paid; Snagly is privileged). Owner chose: use the installed `dataviz` skill for the analytics screen charts. Not adopted: a question round before every screen, Heebo via a GitHub workflow.
- 21.10 Weekly check-in reminder set in iPhone Reminders: every Saturday 11:00, with a link to the app. The in-app reminder idea is no longer needed.
- 21.10 Check-in screen 0.4.0: buttons "צ׳ק-אין שבועי" / "שקילה מהירה" under the numbers. Check-in = date (default today, no future), weight prefilled from the previous weigh-in with −/+ 0.1 buttons, 11 circumference rows with the previous value and date (empty = skipped), tag (רגיל/מחלה/חופשה/אירוע), one-line note (max 120). After saving: back to the verdict with the circumference table open and "סיום" at the bottom (as in the mockup); toast with "ביטול" (undo). Rules (`js/checkin.js`, pure, 14 tests): one weigh-in per date, so saving again on a date edits that day (the form opens with what was saved); imported same-day duplicates are soft-deleted; a cleared circumference that was saved that day is soft-deleted; undo = old versions back, new records soft-deleted (nothing ever removed). Quick weigh-in = weight only, today. npm works in the work environment now: `package-lock.json` added, CI uses `npm ci`, and the WebKit smoke test also runs locally. design-critic is not available as an agent in this session, so the design review was self-review + screenshots (440 and 375); hebrew-writer reviewed the text.
- 21.10 Simpler way of working (owner): no automatic tool scout or reviewer agent per phase/proposal; main agent works and self-reviews by default, agents only per "Review by size". Data rule replaced: unclear label → map only if reliable, otherwise keep the source and report (no silent drops).
- 21.10 Owner: weight chart gets a "6 חודשים" range (last 183 days) between "3 חודשים" and "הכול". On narrow phones the range buttons move to their own line under the figure title. Version 0.4.1.
