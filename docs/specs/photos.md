# Photos spec v1 (phase 3)

Written 21.10.2026 from the owner's scope (PROJECT.md §3, "Phase 3: scope") and three owner decisions taken the same day:
poses = front, side and back; shooting = the camera inside the app; backup = a separate photo backup file.
The prototype in `lab/photos` is the starting point; what changes is marked.

## 1. Flow
- Entry: "תמונות ›" in the verdict header, next to "ניתוח ›". "‹ חזרה" returns.
- Photo screen: pose switch (חזית / צד / גב), the latest edited photo of that pose with its date, the photo grid (newest first), "צילום" and "מהגלריה" (pick an old photo), "לפני ואחרי" and the photo backup row.
- "צילום" opens a session that walks front → side → back. Each step: live camera, timer (3 / 5 / 10 s, default 10, remembered), shutter, "דילוג" to skip the pose. After each shot the edited result is shown with "שמירה" / "צילום חוזר". Leaving mid-session keeps what was saved.
- Camera: front camera by default (the owner can see the screen while posing), flip button for the rear one. Saved photos are never mirrored.
- The photo's date = today (picked from the gallery: today too, editable in the review step, no future dates).
- Not included: ghost overlay, slider/flipbook compare (timelapse is phase 4), background replacement.

## 2. Body detection
- MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`, Apache-2.0), **self-hosted** under `vendor/mediapipe/` (bundle + wasm + `pose_landmarker_lite.task`; switch to `full` only if alignment is visibly off on real photos). No jsDelivr/Google URLs anywhere, including `lab/photos` (closes PROJECT.md §6b item).
- Loaded only when the photo screen opens. Cached by the service worker in its own cache (`bt-model-<ver>`) that app updates do not delete; works offline after the first load.
- Options: `runningMode: 'IMAGE'`, `numPoses: 1`, `outputSegmentationMasks: true` (the mask is used for lighting, §4).
- privacy-guardian review before merge (new library + storing photos).

## 3. Align + crop (pure, tested)
- Landmarks used: shoulders 11/12, hips 23/24, nose 0. All poses use mid-shoulder → mid-hip.
- `alignTransform(sh, hip)` → a **similarity transform only** (one uniform scale + rotation + shift) that puts mid-shoulder at (450, 390) and mid-hip at (450, 770) in a 900×1200 frame. The body is never stretched, warped or slimmed. Area outside the source photo is filled `#000`.
- Checks, in order (`checkPhoto`), each with a Hebrew reason:
  1. no body found → `no_body`
  2. torso shorter than 10 px in the source → `too_small`
  3. any of the 4 points with visibility < 0.5 → `unclear` (warning, still savable)
  4. vs the pose's reference photo (the oldest kept aligned photo of that pose): shoulder-width ÷ torso-length differs by more than 15 % → `pose_changed` (warning); for side, the nose is on the other side of the torso line → `facing_changed` (warning).
- When `no_body` or `too_small`: "צילום חוזר" or "לשמור בלי יישור". An unaligned photo is kept as-is (scaled to fit the frame), marked "לא מיושר" in the grid, and is not offered in before/after. Nothing is ever dropped silently.

## 4. Matched lighting (pure maths, tested)
- Reference = the same pose's reference photo (§3.4). The first photo of a pose is its own reference and gets no change.
- Measure the mean R, G, B of the **background** (pixels outside the segmentation mask, after alignment) of both photos; with no mask, fall back to the whole frame.
- `lightGain(cur, ref)` → one gain per channel = ref ÷ cur, each clamped to 0.7–1.4; changes under 3 % are skipped.
- Applied as a single multiply per channel over the whole image. No local edits, no contrast or sharpening, so muscle definition is not exaggerated.

## 5. Storage
- New IndexedDB store `photos` via a schema migration (existing data untouched).
- Record: `{ id, date, pose: 'front'|'side'|'back', ts, aligned: true|false, img: Blob (JPEG 900×1200, quality 0.88), metrics: { ratio, vis, bg: [r,g,b], facing }, deleted }`. About 150–250 KB per photo.
- **Trial period (owner, 21.10):** the original is kept too (`orig: Blob`, JPEG, long side max 2000 px, quality 0.85, about 400–600 KB), on the phone and in the photo backup, until the owner has seen the edit on real photos. Then the owner decides: keep originals, or stop keeping them (deleting existing originals only with explicit approval). With originals, any photo can be re-edited if the edit is bad or improves later.
- `navigator.storage.persist()` after the first save.
- Delete = soft, with "ביטול" in the toast (as in history).

## 6. Before / after image
- Pick the pose and two photos (defaults: oldest and newest aligned photo of the pose).
- Output: one JPEG, 1800 × 1440: the two photos side by side (earlier on the **right**, RTL), Swiss Lab style: background `#F7F7F5`, 3 px black rule on top, under each photo the date (`DD.MM.YY`, LTR) and the weight.
- Weight = the weigh-in on that date; if none, the nearest within ±3 days, with its date in small text; otherwise "—". 1 decimal + "ק״ג", from a pure function (`photoCaption`), tested. No other numbers on the image.
- Fonts: Heebo from the app (`document.fonts.load` before drawing).
- "שמירה" hands the file to the share sheet (Save Image → Photos). Nothing is uploaded.

## 7. Photo backup (separate file)
- `bodytrack-photos-YYYY-MM-DD.json`: `{ app: 'bodytrack-photos', version: 1, exported, photos: [{...record, img: base64}] }`. About 30–40 MB a year at 3 photos a week with edited photos only; about 3× that while originals are kept (trial period, §5).
- Includes deleted-flagged records (so undo state round-trips). Validated before writing; restore = merge by `id` (a photo never changes except `deleted`).
- Reminder on the photo screen when photos exist that are newer than the last photo backup and it is more than 30 days old.
- The data backup stays as it is (no photos).

## 8. Tests
- node:test: `alignTransform`, `checkPhoto` (each reason), `lightGain` (clamp, skip band), `photoCaption` (exact / nearest / none), photo backup `validate` (fuzzed like the data backup), pose session order.
- Playwright (WebKit 440×956): photo screen with a mocked pose result (no model download in tests), empty state, save + undo, before/after render, no outside requests.

## 9. Review
New screen → design-critic once + hebrew-writer for the text, before showing the owner. privacy-guardian for §2 and §5/§7.
