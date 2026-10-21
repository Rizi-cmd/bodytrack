# MediaPipe Pose Landmarker (self-hosted)

Body detection for the photos screen (spec `docs/specs/photos.md` §2). Runs on the phone; no outside network calls.

| File | Source | Licence |
|---|---|---|
| `0.10.14/vision_bundle.mjs` | npm `@mediapipe/tasks-vision@0.10.14` | Apache-2.0 |
| `0.10.14/vision_wasm_internal.js`, `.wasm` | same package, `wasm/` (SIMD build only; iOS 16.4+) | Apache-2.0 |
| `0.10.14/pose_landmarker_lite.task` | MediaPipe model `pose_landmarker_lite/float16/1` | Apache-2.0 |

Files are unmodified. The folder name carries the version, so the service worker can cache it for good
(`bt-model-0.10.14`); a new version goes in a new folder.
