# Dark redesign, stage 1: home + weigh-in (spec v1, 23.10.2026)

Source: workshop decisions in `docs/PROJECT.md` §7 (23.10), prototype `docs/design/v2/bodytrack-v2.html` (home part).
Stage 1 replaces only the home (verdict) screen and the check-in / quick weigh-in screens. Analytics, photos, history and backup stay light until stages 2–3.

## 1. Look
- Tokens (from the prototype): background `#060818`, ink `#EEF1FF`, muted `#B0B7DA`, faint `#8F97C6`, good `#7DE3C1` (soft mint, owner 23.10), bad `#FF8F87` (soft coral), ice `#A9C4FF`, hairline `rgba(190,200,255,.15)`.
- Muted good (slow, see §3): good at about 55% strength, still with arrow + word. Checked for contrast ≥ 4.5:1 on the background.
- Font: the app's self-hosted Heebo (static weights). No CDN.
- All rules from PROJECT.md still hold: RTL, numbers LTR with the sign on the left (U+2212), min 12px, green/red only for goal direction with arrow + Hebrew word.
- Text never sits on moving particles without a solid or glass backing.

## 2. Home layout (top to bottom)
1. Line: date of the **last weigh-in** (not today) · "שבוע N ל<שלב>". When the last weigh-in is more than 10 days old the date line is louder (ink, 500 weight, "לפני N ימים"). Small "עוד" button at the top left.
2. Verdict word with arrow (58px/800), and the label under it (same words as today's `verdictText`).
3. **The lens**: glass circle (radius ≈ min(42% width, 20% height, 190px)). Inside: the last 4 weigh-ins as dots with their average line (magnified, these are the points the rate is computed from), and over a glass backing the rate (78px/800), "ק״ג לשבוע", "שיפוע ממוצע 4 שקילות". No hint under the lens (owner 23.10: removed). The lens is a button (screen reader: "הוספת שקילה"). Tap → weigh-in screen.
4. Scale −1..+1 kg/week with the ±0.2 stuck band and a marker at the rate (same geometry as `scaleGeometry`).
5. Bottom: wide button "ניתוח ‹" → current analytics screen.
- "עוד" opens a sheet: תמונות, היסטוריה, גיבוי, שלב (the existing phase sheet). History/backup open as today (light) until stage 3.
- Fewer than 5 weigh-ins: lens shows the weigh-ins that exist, verdict "מוקדם להגיד" with the reason, no rate number (—).
- No data: lens with the text "עוד אין שקילות".
- The home fits one screen and never scrolls or bounces under a drag (owner 23.10).

## 3. Slow verdict (owner, 23.10)
- In cut/bulk, when the rate is toward the goal but below the target band (`rateView` zone `below`): the tone is muted good and a small word "איטי" sits next to the label. In range or above: full good, unchanged.
- Maintenance, stuck, away, no phase, too early: unchanged.
- Computed in a pure function (`verdictText` gets the zone) with tests.

## 4. Weigh-in screen (replaces check-in + quick weigh-in)
- One dark screen. Weight first, prefilled from the previous weigh-in, −/+0.1 buttons, date (default today, no future; small, under the weight).
- Weight is the main action (owner, 23.10): it fills the screen (big number, −/+ and "שמירה" right under it, reachable with one thumb). Circumferences are an occasional extra, not equal to the weight: one small secondary line "+ הוספת היקפים" under the save button, never a big section on first view.
- Folded rows, closed by default: "היקפים" (11 sites, previous value + date beside each), "סוג שבוע" (רגיל/מחלה/חופשה/אירוע), "הערה" (max 120).
- One "שמירה" button. Saving with only the weight = quick weigh-in. Same rules as today (`buildCheckin` / `buildWeighin`: one weigh-in per date, typo guard over 2 kg, undo toast).
- "‹ חזרה" closes without saving.

## 5. Motion
- Ambient: dim particle galaxy behind everything (WebGL2), very slow, ≤30 fps; stops when the app is hidden and under iOS Reduce Motion (then a still frame).
- No WebGL2 → static gradient background + CSS glass lens (prototype fallback).
- Touch: dragging on the home bends the particles near the finger; the lens itself does not move.
- Hero moment after a save: the new weigh-in flies into the lens, the oldest of the 4 leaves, the rate number counts to its new value (≤1.2 s). Under Reduce Motion: instant.
- Intro on app open ≤1 s.
- Battery: measured by the owner on the iPhone; if noticeable, ambient gets slower or stops after 20 s idle.

## 6. Build steps (each checked before the next)
1. Pure parts + tests: slow verdict, lens points (last 4 weigh-ins + scaled positions), last-weigh-in line (date, days, stale flag).
2. Dark home, still (no WebGL yet): layout, lens with CSS glass, scale, "ניתוח", "עוד" sheet. Smoke test updated.
3. Dark weigh-in screen.
4. Galaxy + fallback + hero moment + intro. Reduce Motion and hidden-app stop tested.
5. (Order changed by the owner 23.10: step 4 before step 3.) Review: design-critic once + hebrew-writer for the text. Then owner checks on the iPhone (incl. battery).
