# Analytics spec v1 (analytics screen, phase 1)

Defined by fitness-analyst, 21.10.2026. Follows PROJECT.md §2–3 and builds on `docs/specs/trend-engine.md` (cited as "TE §n"). Wherever possible this spec reuses the outputs of `js/trend.js` and `js/report.js` and does not redefine them. Thresholds are marked either with a source (§14) or **convention**. Owner decisions are in §13. All functions are pure: they never read the clock, the caller passes `today` (ISO), and everything is recomputed from scratch after any edit, delete or undo.

> Status: approved 21.10.2026. Owner decisions in §13 settled: all recommendations accepted (1a, 2a, 3a, 4a, 5a, 6a). מותן = narrowest point, מותניים (טבור) = at the navel.

## 0. Shared inputs and helpers

- `points = cleanWeighins(weighins)` (TE §1): soft-deleted records dropped, same-date duplicates averaged, sorted. `series = trendSeries(points)` (TE §2). `S = trendSummary(weighins, phaseRecords, today)` (TE §7). `D` = date of the last point.
- `cleanMeasurements(list) → Map(siteId → [{date, cm}])`. Drop a record if any of these hold: `deleted === true`, invalid ISO date, `site` not in `SITES`, or `cm` not finite or outside 5–300. Same site on the same date → mean (as `circRows`). Sort ascending.
- `tagged(checkins)` = live check-ins whose `tag ∈ {sick, vacation, event}`. Tagged data is **always included** in every calculation, the same as in TE §1. It is only flagged.
- `phaseRuns(records, endDate) → [{phase, from, to, targetKg}]`. Takes `isPhaseRecord` records, sorted by `from`. On the same `from`, the later record wins (as in `activePhase`). Consecutive records with the same phase merge into one run (a cut whose target was edited stays one cut run; its `targetKg` is the last record's value). `to` = the next run's `from` − 1 day; for the last run `to` = `endDate`.
- `phaseStart(records, today)` = `from` of the run active on `today`, or null if there is no phase.
- `trendAt(series, iso, maxGap = 14)` gives the trend level on a date. Let `a` = the last avg point with `date ≤ iso` and `b` = the first avg point with `date ≥ iso`.
  - If `a.date === iso`, return `a.avg`.
  - If `a` or `b` is missing, return null (no extrapolation).
  - If `day(b) − day(a) > maxGap`, return null.
  - Otherwise interpolate linearly on `day()`.
  - It uses `date`, not the centroid `t`, so it matches the plotted line. maxGap 14 is convention.
- `siteAt(siteList, iso, tol = 14)` = the site value whose date is closest to `iso` within ±`tol` days. Ties go to the earlier one. 14 days is convention.

### 0.1 Goal direction per metric, derived from the phase
`metricDirection(metric, phase)` returns −1 (down is the goal), +1 (up is the goal), 0 (holding is the goal, weight only) or null (no colour). It replaces `SITES[].goal` and resolves the open item in PROJECT.md §6b.

| Metric | cut | bulk | maintenance | Reason |
|---|---|---|---|---|
| weight | −1 | +1 | 0 | TE §4 |
| waist_navel, waist | −1 | null | −1 | In a bulk, waist rise is expected; judged by cm-per-kg (§7), not by colour. |
| hips | −1 | null | null | Mixed glute tissue and fat |
| chest, thigh | null | +1 | null | Fat and muscle mixed; a fall in a cut is not attributable |
| shoulders, arm_relaxed, arm_flexed, calf | null | +1 | +1 | Mostly muscle; in a cut a fall is mostly fat plus water, so not judged |
| neck, wrist | null | null | null | Reference sites |

No phase → null everywhere. The whole table is convention (owner decision 2).

### 0.2 Tape error per site (convention)
Assumed error of one self-measurement: same person, same tape, same landmark, morning. A change is coloured only when |Δ rounded| ≥ the **threshold**, about √2 × the per-reading error, rounded up to 0.5 cm. The literature range for waist is wide (intra-observer error 0.7–9.2 cm across studies [S5]); these values sit at the low end and assume good technique.

| Site | ± per reading (cm) | Colour threshold for a change (cm) |
|---|---|---|
| waist_navel, waist, hips, thigh | 0.7 | 1.0 |
| chest, shoulders | 1.0 | 1.5 |
| arm_relaxed, arm_flexed, calf, neck | 0.4 | 0.5 |
| wrist | 0.2 | 0.5 |

### 0.3 Colour rule (whole screen)
- Green or red appears only where §0.1 gives a direction of ±1 (or 0 for weight), always with an arrow and a Hebrew word.
- Items that can be coloured: the rate number (§2, verdict colour), circumference changes (§6), and the parts of the recomposition line (§8).
- Everything else is ink: bars, volatility, cadence, ratios, projection, records, body fat.

## 1. Figure 1: trend vs. weigh-ins with phase bands
- **Plotted:** one dot per `points` entry (`kg`); the line through non-null `avg`, x = `date` (same geometry and `RANGES` as `weightChart`). Tagged weigh-ins are drawn as an open ring; they stay in all maths.
- **Bands:** one band per `phaseRuns(records, D)` entry, x from `max(from, first visible date)` to `min(to, D)`; a band entirely outside the view is not drawn. Fills are alternating neutral greys, never green or red. Label = phase in Hebrew plus "מ-d.m" of the run start, omitted if the band is under 40 px (convention). Time before the first run is unshaded.
- **Empty state:** no points → "אין עדיין שקילות" (placeholder). Fewer than 4 points → dots only, no line, with the TE "too early" note.
- **Edge cases:** soft-deleted records are excluded by `cleanWeighins` and `isPhaseRecord`; same-day weigh-ins → one dot (the mean); the first record has `first: true`, so it spans from the first weigh-in.

## 2. Table 1: rate in kg/week and % of body weight
- **Inputs:** `S.rate`, `S.avg`, `S.verdict`, `S.colour`, `S.provisional`, `S.extended`, `S.phase`. Nothing is recomputed.
- **kg/week:** `S.rate`, `fmtRate`, 2 decimals, signed. Colour and arrow = `S.colour`, same as the verdict.
- **%/week:** `pct = 100 × S.rate / S.avg` (trend average, not last weigh-in, to cut water noise). `p = roundN(pct, 2)`, 2 decimals, signed, with "%". Colour as kg/week.
- **Target band** (in the goal's direction):

| Phase | Band | Basis |
|---|---|---|
| cut | loss 0.50–1.00 %/wk | [S1]: "approximately 0.5 to 1%/wk to maximize muscle retention". From lean natural contest prep; applying it to every cut is convention. |
| bulk | gain 0.25–0.50 %/wk | [S2]: ~0.25–0.5 %/wk novice/intermediate, ~0.25 %/wk advanced. **Owner decision 1** |
| maintenance | no band | The verdict (±0.20 kg/wk) already judges this. |
| none | no band | — |

- **Zone** (ink text; judges speed, not direction). Let m = −p for a cut, +p for a bulk.
  - `S.verdict` stuck → `stuck`; away → `wrong_direction`.
  - toward with m < 0.50 (cut) or < 0.25 (bulk) → `below`.
  - inside the band, bounds included → `in`; above the upper bound → `above`.
  - maintenance or no phase → null.
- **Minimum data:** `S.rate === null` → "—" plus `tooEarlyReason(S.reason, n)`. Provisional and extended footnotes as on the verdict screen (`footnotes()`).
- **Scale:** axis 0 to 1.25 % in the goal's direction; a value outside is clamped with an off-scale cue.
- **Edge cases:** a phase change in the window → current phase band plus the `phaseChangedInWindow` footnote. No phase → numbers shown, no band, "לא נבחר שלב".

## 3. Figure 2: weekly change in the trend
- **Week definition:** fixed 7-day bins ending at D. Bin ends `e_k = D − 7k`, k = 0..8.
- **Bar k** (k = 0..7, newest k = 0): `bar_k = trendAt(series, e_k) − trendAt(series, e_{k+1})`, kg per 7 days. Either `trendAt` null → no bar, an empty slot labelled "—". Interpolation only spans real trend points ≤14 days apart, so a gap never produces made-up bars.
- **Display:** label by `e_k` (d.m); value 2 decimals, signed, minus U+2212, zero "0.00". Ink bars only. Small tag mark if a tagged check-in date falls in `(e_{k+1}, e_k]`. Thin vertical tick at any §1 run boundary inside the 8 weeks.
- **Minimum data:** at least 1 defined bar (needs an avg point at or before D−7). Otherwise "אין מספיק נתונים".
- **Note:** bars use the plotted `date`; the rate uses the centroid `t` (TE §2). The mean of the bars can differ slightly from `S.rate`. Expected; do not reconcile.

## 4. Table 2a: volatility
- **Definition:** residual standard deviation of weigh-ins around a straight line fitted over the last 8 weeks. Units: kg.
- **Window:** `points` with `date ∈ [D−55, D]`. If the current run's start is later than D−55 and at least 6 points lie on or after it, use only those (`sincePhase: true`).
- **Formula:** OLS of `kg` on `day(date)`, residuals rᵢ, `vol = sqrt(Σrᵢ² / (n − 2))`.
- **Minimum data:** n ≥ 6 **and** last − first ≥ 21 days. Otherwise null → "אין מספיק נתונים".
- **Display:** "±" plus 1 decimal, "ק״ג". Ink. Typical 0.4–0.6 kg (TE §3 assumption, convention).
- **Edge cases:** tagged points included; the count of tagged points in the window is returned for a footnote. Same-day duplicates merged first.

## 5. Table 2b: weigh-ins per week and longest gap
- **Reference end:** `E = today` (habit up to now).
- **perWeek:** `W = min(56, E − first + 1)` days (`first` = first date in all history); `n` = merged dates in `[E − W + 1, E]`; `perWeek = n × 7 / W`, 1 decimal. Null if `E − first < 27` → "—".
- **longestGap:** maximum over consecutive merged-date pairs (a, b) with `b ≥ E − 55` (includes a gap straddling the window start) and the open gap `(D, E)` when E > D. Returns `{days, from, to, open}`; on a tie the most recent wins. Integer plus "ימים"; when `open`, a note such as "נמשך עכשיו". Needs ≥2 dates or an open gap, else "—".
- Labels say "ב-8 השבועות האחרונים". Ink.

## 6. Table 3: circumferences (since phase start, since last time)
- **Rows:** `SITES` order, only sites with ≥1 clean value.
- **Current value:** the site's latest value `cur` at date `L`, 1 decimal.
- **Since phase start:** `ps = phaseStart(records, today)`, `base = siteAt(site, ps)` with `base.date < L`; Δ = `cur − base.cm`. No base or no phase → "—". Column header "מ-d.m" of `ps`; when base dates differ between rows, each row shows its own (as `circCaption.perRow`).
- **Since last time:** `cur` minus the site's previous value (reuse `circRows`).
- **Display:** 1 decimal, signed (`fmtChange`), arrow plus word.
- **Colour:** by `metricDirection(site, phase)` and only when |roundN(Δ,1)| ≥ the §0.2 threshold. Below it: ink with "בתוך טעות המדידה" (placeholder).
- **Edge cases:** a skipped site has no value that day, so "previous" can be older than other rows (per-row date shown). Soft-deleted excluded, same-day averaged. A measurement on a tagged date gets a tag mark. After a phase change, baselines follow the new run.

## 7. Table 4: waist-to-hip ratio and cm of waist per kg
- **Site mapping:** hip = `hips` (ישבן), reliable. Waist for the ratio = `waist` (מותן, narrowest point; owner confirmed, decision 4). Label "מותן ÷ ישבן". No WHO risk cut-offs.
- **WHR:** latest date where both sites have a value (never pair across dates). `whr = waist / hips`, 2 decimals, ink. Error ≈ ±0.01 (convention). No same-date pair → "אין מדידה של שני ההיקפים באותו יום".
- **cm of waist per kg:** site `waist_navel` (decision 4). `base = siteAt(waist_navel, ps)`, `cur` = latest. `Δw = cur − base`, `Δkg = trendAt(series, L) − trendAt(series, base.date)` (trend, never a single weigh-in). `ratio = Δw / Δkg`, 1 decimal, unsigned. Error `±(√2 × 0.7)/|Δkg|`, 1 decimal.
  - Shown only when: phase is cut or bulk; both `trendAt` non-null; `sign(Δkg) = direction`; |Δkg| ≥ 2.0 kg (convention). Otherwise "—" with a reason.
  - Label by phase: "ס״מ מותן לכל ק״ג שירד" / "שעלה". Ink.

## 8. Recomposition indicator
- **Inputs:** W = `waist_navel`; A = `arm_relaxed`, or `arm_flexed` if relaxed has no base/current pair. Base and current per §6. The run must have lasted ≥28 days from `ps` to the current measurement date (convention).
- **Rule:** `recomp` when ΔW ≤ −1.0 and ΔA ≥ +0.5; `opposite` when ΔW ≥ +1.0 and ΔA ≤ −0.5; otherwise `none` ("אין סימן ברור"); missing data → `insufficient` ("אין מספיק נתונים").
- **Display:** the two facts with values, each coloured per §0.1 and §0.2. The rule itself is ink.
- **Status:** convention, a tape-based pattern, not a composition measurement.

## 9. Goal projection
- **Inputs:** `targetKg` of the run active on `today`; `S.avg`, `S.rate`, `S.provisional`, `S.verdict`; `dir = weightDirection(phase)`.
- **Reasons, in order:** (1) no phase or maintenance → `no_projection_phase`; (2) no target → `no_target`; (3) `S.rate` null → `too_early`; (4) `dir × (targetKg − S.avg) ≤ 0` → `reached`; (5) `S.provisional` → `provisional`; (6) verdict stuck → `stuck`; (7) verdict away → `wrong_direction`.
- **Formula:** `weeks = (targetKg − S.avg) / S.rate`; `days = ceil(weeks × 7)`, `date = D + days` (UTC). Range: `weeksFast = |rem| / (|rate| + 0.09)`, `weeksSlow = |rem| / (|rate| − 0.09)` (0.09 = TE §3 SE, convention). weeks > 52 → `too_far` ("יותר משנה בקצב הנוכחי"), no date.
- **Display:** weeks rounded to an integer, plus the range (rounded), plus the month and year of `date` (decision 5). Always labelled "הערכה בהנחה שהקצב הנוכחי נשמר" (in a cut the rate usually slows, so this tends to be optimistic). `S.extended` → span footnote. Ink.

## 10. Records
- **All history:** lowest trend `min(avg)` and highest trend `max(avg)`, each with its date; tie → earliest; 1 decimal. Single weigh-ins are not records (water noise).
- **Best 28 days toward the goal, current run only (cut or bulk):** for each avg point p with `date ≥ ps`, reference = avg point closest to p−28 within [p−35, p−21], also `≥ ps`, ties to the older (TE §5). `Δ = p.avg − ref.avg`; best = max of `dir × Δ` with `dir × Δ > 0`. Display Δ signed, 1 decimal, with "d.m–d.m". Otherwise "—".
- **Minimum data:** ≥1 avg point for low/high. Ink.

## 11. Estimated body fat (US Navy), estimate only
- **Shown only if** `setting:heightCm` (120–230, 1 decimal) **and** `setting:sex` ('male' | 'female') exist in `meta` (already carried by the backup). Owner decision 6.
- **Formula** (Hodgdon & Beckett as printed in [S3]), inches (cm / 2.54), log10:
  - Male: `86.010·log10(abdomen − neck) − 70.041·log10(height) + 36.76`; abdomen at the navel [S3] → `waist_navel`.
  - Female: `163.205·log10(waist + hip − neck) − 97.684·log10(height) − 78.387` (standard form; [S3] prints "abdomen − neck", likely a typo; convention). Uses `waist` and `hips`.
  - Not the metric "495/(…) − 450" variant.
- **Inputs:** latest date with the abdomen site (or both waist and hips for women). Neck = latest neck on or before that date, within 90 days (convention); the result says which neck date was used.
- **Guards:** log10 argument ≤ 0 → null; result outside 2–60 → null.
- **Display:** integer "%" with "±4" and "הערכה" (SEE 3–4 %BF [S4]; men bias vs DXA −2.5 ± 3.7 [S3]). Tape under-detects change [S4], so current value only, no change. Ink.
- **Empty states:** no height or sex → hint to enter them in settings (placeholder). Missing site → "אין מדידה של צוואר/בטן".

## 12. Test vectors
Raw values within 1e-9 unless noted. Display strings exact. Dates are 2026.

| # | Function | Input | Expected |
|---|---|---|---|
| R1 | rateView | TE V4, cut | pct −0.619195 → "−0.62%", zone `in`, provisional footnote |
| R2 | rateView | TE V6, bulk | pct +0.350263 → "+0.35%", zone `in` |
| R3 | rateView | TE V6, cut | zone `wrong_direction`, colour bad |
| R4 | rateView | TE V7b, cut | zone `stuck` |
| R5 | rateView | TE V9, cut | avg 80.35, pct −0.290396 → "−0.29%", zone `below` |
| R6 | rateView | 82, 81, 80, 79, 78 weekly 01-03…01-31, cut | avgs 80.5, 79.5; rate −1.0; pct −1.257862 → "−1.26%", zone `above` |
| R7 | rateView | TE V5, maintenance | "0.00%", band null, zone null |
| B1 | weeklyBars | TE V6 series | bars ending 06-20, 06-13, 06-06, 05-30 = +0.25 each → "+0.25"; 05-23 and older → null |
| B2 | weeklyBars | avg points only 01-10 = 80.0, 01-20 = 79.0 (D = 01-20) | trendAt(01-13) = 79.7; bar 01-20 = −0.70 → "−0.70"; others null |
| B3 | weeklyBars | avg points 01-01 = 80.0, 01-20 = 79.0 | trendAt(01-13) null (gap 19 > 14); no bars → "אין מספיק נתונים" |
| VO1 | volatility | weekly from 01-03 (8 pts): 80.5, 79.4, 79.3, 80.2, 80.1, 79.0, 78.9, 79.8 | slope −0.1 kg/wk, residuals ±0.5; vol 0.577350 → "±0.6" |
| VO2 | volatility | first 5 points of VO1 | null, "אין מספיק נתונים" |
| VO3 | volatility | 80.0 − 0.1k, k = 0..7 weekly | 0 → "±0.0" |
| C1 | cadence | Sundays 01-04…03-01 (9 dates), today 03-01 | W 56, n 8, perWeek 1.0 → "1.0"; gap 7 (02-22→03-01), open false |
| C2 | cadence | same, today 03-21 | n 6 → 0.75 → "0.8"; gap 20 (03-01→03-21), open true |
| C3 | cadence | 01-01, 01-08, 01-15, 01-22; today 01-28 | W 28, perWeek 1.0; gap 7 (01-15→01-22) |
| C4 | cadence | same, today 01-22 | perWeek null "—"; gap 7 |
| T1 | circTable | cut from 06-01, today 07-20. waist_navel: 05-20 95.0, 06-03 94.0, 07-01 93.2 + 93.4 (same day), 07-15 93.6, deleted 07-15 90.0. hips: 06-01 100.0, 07-15 98.5. chest: 07-15 104.0 | waist_navel cur 93.6; since start −0.4 (base 06-03), ink, within-noise; since last +0.3 (prev 07-01 mean 93.3), ink. hips since start −1.5 good ↓, since last −1.5 good ↓. chest both "—". No other rows. |
| D1 | metricDirection | (waist, bulk), (arm_flexed, cut), (arm_flexed, maintenance), (wrist, cut), (weight, maintenance), (hips, none) | null, null, +1, null, 0, null |
| W1 | waistHip | 07-15 waist 82.0 and hips 98.0; 07-22 waist only | uses 07-15: 0.836735 → "0.84" |
| K1 | waistPerKg | cut from 06-01; avg points weekly 06-03…07-15 = 85.0 − 0.5k; waist_navel 06-03 94.0, 07-15 91.0 | Δkg −3.0, Δw −3.0, ratio 1.0 → "1.0", ± 0.33 → "±0.3" |
| K2 | waistPerKg | as K1 but avg 07-15 = 83.5 (Δkg −1.5) | null, too_small |
| RC1 | recomp | K1 data + arm_relaxed 06-03 35.0, 07-15 35.6 | `recomp` |
| RC2 | recomp | arm_relaxed 07-15 35.4 | `none` |
| RC3 | recomp | phase from 07-01 | `insufficient` (<28 days) |
| P1 | projection | TE V6, bulk, target 75.0 | weeks 14.5 → "15"; date 2026-09-30; range 11–23 |
| P2 | projection | TE V6, cut, target 68.0 | `wrong_direction` |
| P3 | projection | TE V6, bulk, target 71.0 | `reached` |
| P4 | projection | TE V6, bulk, target 90.0 | `too_far` (74.5 weeks) |
| P5 | projection | TE V4, cut, target 75.0 | `provisional` |
| P6 | projection | TE V5, cut, target 75.0 | `stuck` |
| P7 | projection | TE V6, maintenance / bulk with no target | `no_projection_phase` / `no_target` |
| RE1 | records | TE V6, bulk from 05-02 | low 70.375 (05-23) → "70.4"; high 71.375 (06-20) → "71.4"; best28 +1.0 (05-23–06-20) → "+1.0" |
| RE2 | records | TE V6, cut from 05-02 | low and high as RE1; best28 null "—" |
| N1 | navyBodyFat | male, 180 cm, waist_navel 90, neck 40 | 18.46 (±0.01) → "18" |
| N2 | navyBodyFat | female, 165 cm, waist 70, hips 95, neck 32 | 25.10 (±0.05) → "25" |
| N3 | navyBodyFat | male, neck 40 ≥ abdomen 40 | null |
| N4 | navyBodyFat | no heightCm | null, reason `no_height` |
| N5 | navyBodyFat | male; neck measured 100 days before abdomen | null, reason `no_neck` |

N1/N2 were computed by hand; check against an independent calculation when building.

## 13. Owner decisions (settled 21.10.2026: all recommendations accepted)
1. **Bulk target band (§2).** (a) 0.25–0.5 %/wk; (b) ~0.25 %/wk; (c) no band. Recommendation: (a).
2. **Circumference colours by phase (§0.1).** (a) The §0.1 table; (b) keep the fixed `SITES[].goal`; (c) all neutral. Recommendation: (a).
3. **Noise threshold before colouring a circumference change (§0.2).** (a) Per-site thresholds, smaller changes "בתוך טעות המדידה"; (b) colour every change. Recommendation: (a).
4. **Which waist is which.** (a) מותן = narrowest point, טבור = navel; (b) both at the navel → no WHR; (c) unsure → WHR hidden. Recommendation: (a) if confirmed.
5. **Projection display (§9).** (a) Weeks + range + month; (b) exact date; (c) weeks only. Recommendation: (a).
6. **Body fat (§11).** (a) Add height and sex to settings (phone and backup only); (b) leave out for now. Recommendation: (a) only if wanted; ±4 points at best.

## 14. Sources (opened 21.10.2026)
- [S1] Helms, Aragon, Fitschen 2014, contest-prep nutrition recommendations: https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/
- [S2] Iraki et al. 2019, off-season nutrition for bodybuilders: https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/
- [S3] Frontiers in Physiology 2022, military circumference equations vs DXA: https://frontiersin.org/articles/10.3389/fphys.2022.868627/full
- [S4] Frontiers in Physiology 2023 (PMC10282178), tape vs DXA change during basic training: https://pmc.ncbi.nlm.nih.gov/articles/PMC10282178
- [S5] Verweij et al., "Measurement error of waist circumference: gaps in knowledge" (Public Health Nutrition): https://www.cambridge.org/core/product/A92F39494EFCF5CE236AE42B9B229302/core-reader
