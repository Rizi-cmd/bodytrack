# Weight page (journey) + home ring: data spec v1
fitness-analyst, 23.10.2026. Builds on TE (`docs/specs/trend-engine.md`) and AN (`docs/specs/analytics.md`). All functions pure, caller passes `today`; `S = trendSummary(weighins, records, today)`. New thresholds not from a source are marked convention; cut/bulk bands are AN §2.

## 0. Reused, not redefined
`cleanWeighins`, `trendSeries`, `trendSummary`, `roundN`, `fmtWeight`, `fmtChange`, `fmtRate`, `weightDirection`, `phaseRuns`, `phaseStart`, `activePhase`, `trendAt`, `projection`, `rateView`, `rateZone`, `verdictText`, `lastWeighinLine`, `phasePick`, `STALE_DAYS`, `MIN_WEIGHINS`.

## 1. Hero: current weight
- n ≥ 4: `S.avg` → `fmtWeight`, label "ממוצע 4 השקילות האחרונות".
- 1–3: `S.latest.kg`, label "שקילה אחרונה"; the last-weigh-in row is hidden (would repeat the hero).
- 0: empty state.

## 2. Journey series: `journeyPoints(series, records, today)`
- Start `ps` = `phaseStart(records, today)`; no phase → first weigh-in date.
- One point per calendar week, Sunday–Saturday. Week index = `floor((day(date)+4)/7)`. Point = last avg point in that week with `date ≥ ps`, at its real date and avg. No interpolation; last point is always `S.avg` at D. Calendar weeks are stable (adding a weigh-in never reshuffles older points).
- Gaps: no avg point in a week → no point. Line drawn only between consecutive points ≤ 14 days apart (convention, same maxGap as `trendAt`); otherwise separate segments. The bolt runs only on drawn segments.
- Start marker: `(base.date, base.kg)` from §3, hollow, no glow, labelled with its value.
- n < 5: raw weigh-ins with `date ≥ ps` as dim dots; no line, no projection.
- Phase started before the first weigh-in: points begin at the first avg point. Phase only 1–2 weigh-ins old: show the 1–2 points; if `base.date === D`, change is "—".
- Returns `{segments:[[{date,kg}]], start:{date,kg}|null, raw:[{date,kg}]}`.

## 3. Change since start and % of the way: `phaseProgress(S, records, today)`
- `base = trendAt(series, ps)`; if null, first avg point with `date ≥ ps`. Never a single weigh-in (±0.5 kg water noise, TE §3).
- `change = S.avg − base` → `fmtChange`; null when n < 5 or `base.date === D` → "—".
- `p = (S.avg − base)/(target − base)`, only when phase is cut or bulk, a target is set, and `dir×(target − base) > 0`; otherwise `pct = null`, ring empty.
- `pct = clamp(floor(100p + 1e-9), 0, 100)` → "N% מהדרך ליעד". Ring fill `clamp(p, 0, 1)`. Moving away → 0%, empty ring (signed change shows reality). p > 1 → 100% + "הגעת ליעד".
- Ring number neutral ice-blue; green/red only on the verdict word.

## 4. Change over 30 days
`S.monthChange` (28 days, reference in [D−35, D−21], none → "—"). Label must be "ב-4 שבועות". Analyst recommends removing it (≈4× the rate next to it).

## 5. Projection: `journeyProjection(S, records, today)`
- `projection(...)` + guard: `today − D > STALE_DAYS` → reason `stale` (convention), "השקילה האחרונה ישנה מדי לצפי".
- Hidden whenever reason is not null: `no_projection_phase`, `no_target`, `too_early`, `reached`, `provisional`, `stuck`, `wrong_direction`, `too_far` (> 52 weeks → "יותר משנה בקצב הנוכחי", no line), `stale`.
- Dashed line `(D, S.avg)` → `(proj.date, target)`. End label = month name only. Weeks: `weeksText`, range `(fast–slow)` only if fast ≠ slow. Footnote "הערכה בהנחה שהקצב הנוכחי נשמר" whenever shown.
- kg left: `|target − S.avg|`, 1 decimal, no sign; `dir×(target−S.avg) ≤ 0` → "הושג".
- Y scale always includes the target when set.

## 6. Phases
- Cut/bulk: same formulas, sign from `weightDirection`.
- Maintenance: no target line, no projection, empty ring; "בשמירה אין יעד"; no "הגדרת יעד" link; change since start still shown in ink.
- No phase: journey from first weigh-in, "לא נבחר שלב" + "בחירת שלב ‹".
- Reached (judged on the trend): ring 100%, "הגעת ליעד · שינוי שלב ‹", no projection.
- Phase row on the page: "שלב: חיטוב · מ-1.9 · יעד 78.0 ‹" opens the phase sheet (`phasePick`); replaces a separate "הגדרת יעד ‹" link.
- Home "שבוע N לחיטוב": `phaseWeek` = `floor((today − ps)/7) + 1`.

## 7. Layout recommendations
- Grid: rate kg/week (`fmtRate`) · %/week (`rateView`, caption "יעד 0.5–1%" cut / "0.25–0.5%" bulk) · kg left.
- One row: "צפי: נובמבר 2026 · 5 שבועות (4–6)".
- Last weigh-in row: `fmtWeight(S.latest.kg)` · `fmtDay`, "לפני N ימים" when stale.
- Everything in ink (direction colour lives in the home verdict).
- n < 5: "צריך לפחות 5 שקילות לקצב" (from `tooEarlyReason`).

## 8. Test vectors (2026, weekly unless noted)
| # | Function | Input | Expected |
|---|---|---|---|
| J1 | journeyPoints | TE V6, bulk from 05-02 (first) | points 05-23 70.375, 05-30 70.625, 06-06 70.875, 06-13 71.125, 06-20 71.375; 1 segment; start 05-23 70.375 (fallback) |
| J2 | journeyPoints | 80.0 on 01-03, 01-10, 01-17, 01-24, 01-31; 79.0 on 03-07, 03-14; cut from 01-03 | points 01-24 80.0, 01-31 80.0, 03-07 79.75, 03-14 79.5; 2 segments (gap 35 > 14) |
| J3 | journeyPoints | 80.0 on 01-01..01-04; 79.6 on 01-08; 79.2 on 01-09; 79.0 on 01-11 | week 01-04..01-10 → 01-09 79.7; week 01-11.. → 01-11 79.45; week 12-28..01-03 none |
| J4 | journeyPoints | 3 weigh-ins (TE V2) | segments [], raw 3 dots |
| G1 | phaseProgress | J1 data, target 75.0 | change +1.0 → "+1.0"; p 0.216216 → "21%" |
| G2 | phaseProgress | 82, 81.5, 81, 80.5, 80, 79.5 (01-03…02-07), cut from 01-27, target 78 | base trendAt(01-27) 81.035714; change −0.785714 → "−0.8"; p 0.258824 → "25%" |
| G3 | phaseProgress | G2 data, cut from 01-20 | trendAt null → base 01-24 81.25; change −1.0 → "−1.0"; p 0.307692 → "30%" |
| G4 | phaseProgress | cut, base 80.0, avg 80.4, target 78 | p −0.2 → "0%", fill 0, change "+0.4" |
| G5 | phaseProgress | cut, base 81.0, avg 79.5, target 80.0 | p 1.5 → "100%", reached |
| G6 | phaseProgress | cut, base 80.0, target 81.0 | pct null, ring empty |
| G7 | phaseProgress | maintenance / bulk no target | pct null; change still shown |
| G8 | phaseProgress | TE V4 with first record cut | base 81.25 at 01-24; change −0.5 → "−0.5" |
| P1 | journeyProjection | TE V6, bulk, target 75, today 06-20 | as AN P1: "15" weeks, range 11–23, 09-30 → "ספטמבר 2026"; line (06-20, 71.375) → (09-30, 75.0); kg left "3.6" |
| P2 | journeyProjection | same, today 07-01 (11 days) | reason `stale`, hidden |
| P3 | journeyProjection | same, today 06-30 (10 days) | shown (boundary) |
| W1 | phaseWeek | ps 09-01, today 09-01 / 09-07 / 09-08 | 1 / 1 / 2 |

## 9. Decisions (23.10)
- Owner: the 30-day change is removed; %/week of body weight with the target band takes its place (grid = kg/week · %/week · kg left).
- Main agent: projection hidden when the last weigh-in is older than 10 days (`stale`); no "הגדרת יעד" link in maintenance; end label = month name only.
