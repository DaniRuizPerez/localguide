# Local Guide

Offline-first mobile tourist guide. Runs a small language model **on-device** (Gemma 3 1B, int4) so travelers get location-aware recommendations about landmarks, history, food, and hidden gems — with **no internet connection required** after setup.

Built with **React Native + Expo + TypeScript**, GPS via `expo-location`, and native LiteRT / MediaPipe LLM inference bridged through a custom native module.

---

## Features

- **Chat** — ask questions about where you are; model answers as a local guide
- **Map** — see your current location, explore nearby points of interest
- **Auto-guide** — proactive narration as you move between locations
- **Voice** — speech-to-text input + text-to-speech output for hands-free use
- **On-device inference** — Gemma 3 1B int4 (≈530 MB) runs fully offline via LiteRT
- **Resumable model download** — fetch once, pause/resume/retry, persist locally

---

## Architecture

```
App.tsx
 ├─ ModelDownloadScreen   ← first-run; downloads Gemma .task file
 └─ AppNavigator
     ├─ ChatScreen        ← user Q&A, uses LocalGuideService
     └─ MapScreen         ← map view + auto-guide

src/
 ├─ services/
 │   ├─ InferenceService          native LiteRT wrapper (load model, run inference)
 │   ├─ LocalGuideService         builds GPS-aware prompt → InferenceService
 │   ├─ ModelDownloadService      resumable download of Gemma .task bundle
 │   ├─ AutoGuideService          triggers narration on location change
 │   ├─ SpeechService             text-to-speech
 │   └─ VoiceRecognitionService   speech-to-text
 ├─ hooks/
 │   ├─ useLocation               GPS with permission + watch
 │   ├─ useAutoGuide              subscribes to AutoGuideService
 │   └─ useVoiceInput             mic capture + transcription
 ├─ native/
 │   └─ LiteRTModule              TS bridge for native LiteRT (iOS/Android)
 ├─ navigation/AppNavigator       bottom-tab nav (Chat / Map)
 └─ __tests__/                    Jest + @testing-library/react-native
```

### Model

- **File:** `gemma3-1b-it-int4.task`
- **Source:** `https://storage.googleapis.com/mediapipe-models/llm_inference/gemma3/int4/gemma3-1b-it-int4.task`
- Downloaded on first launch → stored at `${FileSystem.documentDirectory}models/`
- Loaded into LiteRT native runtime; prompt includes current GPS coords

---

## Getting started

### Prerequisites

- Node.js 18+
- Expo CLI (`npx expo …` works without global install)
- For device builds: Xcode (iOS) or Android Studio (Android)

### Install

```bash
npm install
```

### Run

```bash
npm start          # Expo dev server
npm run ios        # native iOS build (required for real inference)
npm run android    # native Android build (required for real inference)
npm run web        # web preview (mock inference only)
```

> **Note:** Expo Go **cannot run real inference** — the LiteRT native module must be linked. Use `expo run:ios` / `expo run:android` or an EAS build. Without the native module, `InferenceService` falls back to a mock response.

### Test & typecheck

```bash
npm test
npm run typescript
```

---

## Build & release

EAS Build config lives in `eas.json`. CI workflows under `.github/`.

```bash
eas build --platform ios
eas build --platform android
```

---

## Permissions

- **Location** (iOS + Android) — foreground location always required; **background location** required for auto-guide GPS polling
- **Internet** (Android) — only used once to fetch the model bundle
- **Microphone** (iOS + Android) — voice input
- **Foreground service** (Android) — `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` required for background GPS polling during auto-guide

---

## License

TBD
