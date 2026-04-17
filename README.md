# Local Guide

Offline-first mobile tourist guide. Runs a small language model **on-device** (Gemma 3 1B, int4) so travelers get location-aware recommendations about landmarks, history, food, and hidden gems — with **no internet connection required** after setup.

Built with **React Native 0.83 + Expo SDK 55 + TypeScript**, GPS via `expo-location`, and native LiteRT / MediaPipe LLM inference bridged through a custom native module.

---

## Features

- **Chat** — ask questions about where you are; model answers as a local guide
- **Camera** — tap 📷 to take a photo; image shown inline in chat with a GPS-aware guide response
- **Map** — see your current location, explore nearby points of interest
- **Auto-guide** — proactive narration as you move between locations
- **Voice** — speech-to-text input + text-to-speech output for hands-free use
- **On-device inference** — Gemma 3 1B int4 (≈530 MB) runs fully offline via LiteRT
- **Resumable model download** — fetch once, pause/resume/retry, persist locally
- **Location fallback** — manual location entry when GPS is denied or unavailable

---

## Architecture

```
index.js                 ← entry point (registers 'main' via registerRootComponent)
 └─ App.tsx
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
 │   ├─ useLocation               GPS with permission + watch; manual fallback
 │   ├─ useAutoGuide              subscribes to AutoGuideService
 │   └─ useVoiceInput             mic capture + transcription
 ├─ native/
 │   └─ LiteRTModule              TS bridge for native LiteRT (iOS/Android)
 ├─ theme/
 │   └─ colors.ts                 centralized color palette (amber, teal, warm neutrals)
 └─ navigation/AppNavigator       bottom-tab nav (Chat / Map)
```

### On-device model

| Property | Value |
|---|---|
| Model | Gemma 3 1B int4 |
| File | `gemma3-1b-it-int4.task` |
| Size | ≈530 MB |
| Source | Google MediaPipe model hub |
| Storage | `${FileSystem.documentDirectory}models/` (downloaded on first launch) |

> **Vision limitation:** Gemma 3 1B via the LiteRT LM Inference API is **text-only** — the `runInference` call accepts only a string prompt. When users capture a photo, the guide responds with a location-aware description using GPS context as a proxy. True image→text on-device would require a multimodal model (e.g. PaliGemma) via the LiteRT image inference pipeline.

---

## Development setup

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 (LTS) | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| JDK | 17 | Android builds only — [Temurin](https://adoptium.net/) recommended |
| Android Studio | Ladybug (2024.2.1+) | Includes Android SDK |
| Android SDK | API 35 | Install via Android Studio SDK Manager |

### Install JS dependencies

```bash
npm install --legacy-peer-deps
```

### Run the Expo dev server

```bash
npm start          # Expo dev server (Metro bundler)
npm run android    # launch on connected Android device / emulator
npm run ios        # launch on iOS simulator (Mac only)
```

> **Note:** Expo Go **cannot run native inference** — the LiteRT module must be linked. Use `expo run:android` / `expo run:ios` or open the `android/` folder in Android Studio. Without the native module linked, `InferenceService` falls back to a mock response.

---

## Opening in Android Studio

The `android/` folder is a standard Android Gradle project and can be imported directly.

### Steps

1. **Clone the repo**
   ```bash
   git clone https://github.com/DaniRuizPerez/localguide.git
   cd localguide
   ```

2. **Install JS dependencies** (Gradle reads from `node_modules`)
   ```bash
   npm install --legacy-peer-deps
   ```

3. **Open the project in Android Studio**
   - Launch Android Studio → **Open** → select the `android/` subfolder
   - Android Studio will detect it as a Gradle project and prompt you to sync

4. **Set your Android SDK path**

   Android Studio creates `android/local.properties` automatically when you open the project. If it doesn't, create it manually:
   ```
   # android/local.properties
   sdk.dir=/path/to/your/Android/sdk
   ```
   Common paths:
   - macOS: `sdk.dir=/Users/<you>/Library/Android/sdk`
   - Linux: `sdk.dir=/home/<you>/Android/Sdk`
   - Windows: `sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk`

5. **Sync Project with Gradle**
   - Click **Sync Project with Gradle Files** (elephant icon in toolbar)
   - First sync downloads Gradle 8.13 + all dependencies — takes several minutes
   - Subsequent syncs are fast (cached)

6. **Run on device / emulator**
   - Connect an Android device (USB debugging on) or start an AVD
   - Click the green **Run** button or use `Shift+F10`

> `android/local.properties` is in `.gitignore` and never committed — each developer sets their own SDK path.

---

## Building without an emulator (CI / compile checks)

These checks verify the project compiles and is correct without needing a running device:

| Check | Command | What it catches |
|---|---|---|
| TypeScript | `npm run typescript` | Type errors, missing imports |
| Unit tests | `npm test` | Logic regressions, component rendering |
| Gradle compile | `cd android && ./gradlew assembleDebug` | Native build errors, broken Gradle config |
| Android Lint | `cd android && ./gradlew lint` | Android-specific code issues |

All four run automatically in CI (GitHub Actions) on every push and PR.

### Running the Gradle build locally

```bash
# Install JS deps first (Gradle scripts call node to resolve paths)
npm install --legacy-peer-deps

# (If you wiped the android/ folder) regenerate native project
npx expo prebuild --platform android

# Set your SDK path
echo "sdk.dir=$ANDROID_SDK_ROOT" > android/local.properties   # or set manually

# Build debug APK
cd android
./gradlew assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Permissions

| Permission | Platform | Required for |
|---|---|---|
| `ACCESS_FINE_LOCATION` | Android + iOS | GPS positioning |
| `ACCESS_BACKGROUND_LOCATION` | Android | Auto-guide GPS polling |
| `RECORD_AUDIO` | Android + iOS | Voice input |
| `CAMERA` | Android + iOS | Photo capture for vision queries |
| `INTERNET` | Android | One-time model download |
| `FOREGROUND_SERVICE` | Android | Background GPS during auto-guide |
| `FOREGROUND_SERVICE_LOCATION` | Android | Required for foreground service with location type (API 34+) |

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.83 + Expo SDK 55 |
| Language | TypeScript |
| Navigation | React Navigation v6 (bottom tabs + native stack) |
| Location | expo-location |
| Voice in | expo-speech-recognition |
| Voice out | expo-speech |
| Camera / photo | expo-image-picker |
| Background tasks | expo-task-manager |
| File storage | expo-file-system |
| Native inference | LiteRT (TFLite runtime) via custom native module |
| Model | Gemma 3 1B int4 via MediaPipe LLM Inference API |
| CI | GitHub Actions — TypeScript, Jest, Gradle assembleDebug, Android Lint |

---

## License

TBD
