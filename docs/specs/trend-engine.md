# Trend engine spec v1 (weight only, verdict screen)

Defined by fitness-analyst, 21.10.2026. Follows PROJECT.md §2–3; deviations are marked. Thresholds are conventions, not cited evidence.
Owner decisions still open are listed at the end (§11).

## 1. Input and cleaning: `cleanWeighins(list) → [{date, kg}]`
- Input `[{id, date:'YYYY-MM-DD', kg, deleted?}]`.
- Drop: `deleted === true`; invalid ISO date; `kg` not finite or outside 30–300.
- Same-date duplicates (both live): merge into one point, `kg` = mean of that date. Order-independent.
- Sort ascending by date.
- Day arithmetic: `day(iso) = Date.UTC(y, m-1, d) / 86400000`. Never local Date parsing (DST).
- Check-in tags (sick/vacation/event): included. The engine returns `windowDates` so the UI can footnote a tagged weigh-in inside the rate window.
- Segments: **never reset** (owner, 21.10). All points form one series, however long a gap is. The centroid `t` (§2) keeps the slope correct across gaps. `segment` fields and `gap_reset` below are dropped.

## 2. Trend (average): `trendSeries(points) → [{date, kg, avg, t, segment}]`
- Point i with ≥3 earlier points in the same segment: `avg_i = mean(kg[i-3..i])`, else `null`.
- `date` = date of point i (chart line, window membership). `t` = mean of `day()` of the 4 contributing points (centroid), used only for the slope. Reason: with irregular spacing, dating by the last point biases the slope (V9).
- Chart: gaps where avg is null, broken between segments.
- Headline "average of 4 weigh-ins" = avg of the last point; null if the current segment has <4 points.

## 3. Weekly rate: `weeklyRate(series)`
- `D` = date of the last point. Window = avg points in the current segment with `date ∈ [D−28, D]`.
- OLS of `avg` on `t`; rate = slope × 7 (kg/week), full precision.
- Rate = null unless all hold: ≥2 avg points in window (≥5 weigh-ins in segment); ≥14 days from the earliest weigh-in feeding the window to D; current segment only.
- `provisional: true` when the window has <3 avg points (SE ≈ ±0.18 kg/wk vs ≈ ±0.09 with a full window, assuming single weigh-in noise σ ≈ 0.4–0.6 kg).
- **Deviation:** "too early" = fewer than 5 weigh-ins (not 4): one average point has no slope.

## 4. Direction and verdict
`weightDirection(phase)`: cut → −1, bulk → +1, maintenance → 0, none → null. Phase = the one active on D.

`verdict(rate, direction)` with `r = round2(rate)` (display and verdict always agree):

| Condition | Verdict | Colour | Arrow |
|---|---|---|---|
| rate null | `too_early` | ink | none |
| direction null | `no_phase` | ink | sign of r |
| \|r\| < 0.20, cut/bulk | `stuck` | ink | flat |
| \|r\| < 0.20, maintenance | `holding` | good | flat |
| \|r\| ≥ 0.20, sign = direction | `toward` | good | sign of r |
| \|r\| ≥ 0.20, maintenance or opposite | `away` | bad | sign of r |

- Exactly 0.20 counts as movement.
- `toward` does not judge speed (that is analytics).
- Return `phaseChangedInWindow` when the phase changed inside the window.

## 5. Change vs previous month: `monthChange(series)`
- Reference = avg point in the current segment whose date is closest to D−28, within [D−35, D−21]; tie → older.
- `monthChange = avg_last − avg_ref` plus `refDate`; null if missing. Rolling 28 days, not calendar month.

## 6. Rounding and display
| Value | Decimals | Sign |
|---|---|---|
| Today's weigh-in | 1 | none |
| Average of 4 | 1 | none |
| Change vs month | 1 | always, except 0 |
| Rate | 2 | always, except 0 |

- `roundN(v, n) = Math.sign(v) * Math.round(Math.abs(v) * 10**n + 1e-7) / 10**n`, then `toFixed(n)`.
- Rounded zero shows without a sign, never −0.00. Minus U+2212, LTR, sign on the left.
- Round only for display and the verdict comparison.
- **Deviation:** don't use the existing `fmtKg` here (2 decimals, raw toFixed misrounds halves).
- Empty value: `—` plus a "too early" note (wording by hebrew-writer).

## 7. Composite: `trendSummary(weighins, phase)`
```
{ latest:{date,kg}|null, avg, rate, rateRounded, provisional, windowDates,
  monthChange, monthRefDate, direction, verdict, phaseChangedInWindow,
  reason: null|'no_data'|'need_more_weighins'|'gap_reset'|'span_too_short',
  series }
```
Pure; never reads the clock; recomputes from scratch after any edit/delete/undo.

## 8. Edge cases
1. Empty or only deleted → `no_data`.
2. Same date twice → mean; deleted duplicate ignored.
3. Irregular spacing → centroid t handles it.
4. Any gap is bridged (no reset). If a long gap leaves fewer than 2 average points in the 28-day window, rate is null (`need_more_weighins`).
5. Five weigh-ins within <14 days → `span_too_short`.
6. Rate rounding to ±0.20 = movement; ±0.19 = stuck/holding.
7. Rate rounding to zero → no sign.
8. DST → UTC day arithmetic.
9. No phase → `no_phase`, rate shown, no colour.
10. Phase changed in window → flag, use current phase.

## 9. Test vectors (raw within 1e-9, display strings exact; weekly dates unless noted)
| # | Input | Phase | Expected |
|---|---|---|---|
| V1 | `[]` | cut | latest null, avg null, rate null, `too_early`, `no_data` |
| V2 | 80.0, 79.8, 79.6 (2026-01-03, -10, -17) | cut | latest 79.6, avg null, rate null, `too_early`, `need_more_weighins` |
| V3 | 80.0, 79.6, 79.4, 79.0 (01-03…01-24) | cut | avg 79.5 → "79.5"; rate null; `too_early` |
| V4 | 82.0, 81.5, 81.0, 80.5, 80.0 (01-03…01-31) | cut / bulk / maint. | avgs 81.25, 80.75; rate −0.50 → "−0.50"; `toward` / `away` / `away`; avg "80.8"; monthChange null; provisional true |
| V5 | 80.0, 80.4, 79.8, 80.2, 80.0, 80.4, 79.8, 80.2 (03-07…04-25, crosses DST) | cut / maint. | all avgs 80.1; \|rate\| < 1e-9 → "0.00"; `stuck` / `holding`; monthChange 0 → "0.0" (ref 03-28) |
| V6 | 70.00 + 0.25k, k=0..7 (05-02…06-20) | bulk / cut | avgs 70.375…71.375; rate +0.25 → "+0.25"; `toward` / `away`; avg "71.4"; monthChange +1.0 → "+1.0" (ref 05-23) |
| V7a | 80.0 ×4, then 79.2 (01-03…01-31) | cut | avgs 80.0, 79.8; rate −0.20 → "−0.20"; `toward` |
| V7b | 80.0 ×4, then 79.3 | cut | rate −0.175 → "−0.18"; `stuck` |
| V8 | 80.0 on 01-03, 01-10, 01-17, 01-24; 78.0 on 03-07 | cut | no reset; latest 78.0; avg 79.5 → "79.5"; only 1 avg point in window → rate null, `too_early` (to be re-verified by fitness-analyst) |
| V9 | 81.0, 80.8, 80.6, 80.4 (01-03…01-24), 79.6 on 02-14 | cut | avgs 80.7 (t = 01-03+10.5), 80.35 (t = 01-03+21); rate −0.2333 → "−0.23", `toward` (last-point dating would give −0.12, stuck: wrong) |
| VF | tests/fixtures/sample-backup.json | cut | 16 points; window avgs 81.875, 81.625, 81.2, 80.925, 80.575; rate −0.33 → "−0.33", `toward`, provisional false; avg "80.6"; monthChange −1.3 → "−1.3" (ref 2026-09-12); latest "80.2" |

## 10. Goal direction open item
- Doesn't block the trend engine: weight direction comes only from `weightDirection(phase)`, never `SITES[].goal`.
- Blocks circumference colours on the verdict screen; until the per-site mapping by phase is defined, circumference changes are neutral ink.
- The fixture has `goals: []`; tests pass the phase directly until a phase record exists.

## 11. Owner decisions
1. Maintenance `holding` colour: **green** (decided 21.10).
2. Verdict needs **5 weigh-ins** (decided 21.10).
3. New-segment gap: **never reset** (decided 21.10).
