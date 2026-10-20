# BodyTrack

Personal progress-photo tracker, installed on iPhone as a web app (PWA).

## Privacy

- Photos and all personal data are stored **only on the phone** (IndexedDB). This repository contains code only.
- Nothing is uploaded. There is no server, no account, no analytics.
- The only network requests are the app files themselves and the open-source
  [MediaPipe](https://github.com/google-ai-edge/mediapipe) pose library and model, downloaded once
  and then cached for offline use. Body detection runs on the device.
