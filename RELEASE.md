# Release Build Runbook

## Required environment variables

| Variable | Purpose | Where it's read |
|---|---|---|
| `MAPS_API_KEY` | Google Maps Android SDK key (injected into `AndroidManifest.xml` at build time) | `android/app/build.gradle:111-113` — resolved from Gradle property, `local.properties`, or env var, in that order |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Same key exposed to the React Native layer | `src/services/MapsService.ts:16` and `src/screens/MapScreen.tsx:339` |
| `EXPO_PUBLIC_HF_TOKEN` | HuggingFace read token for the gated Gemma model repo | `src/services/ModelDownloadService.ts:105` — used in `Authorization: Bearer` header on download |

Both `MAPS_API_KEY` and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` should be set to the **same** API key value. The dual naming exists because the Android build system (Gradle) and the Metro bundler (React Native) read env vars independently.

## Setting env vars locally

Add to `android/local.properties` (gitignored):
```
MAPS_API_KEY=AIza...
```

Add to `.env` (gitignored, read by Metro via `expo-constants`):
```
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
EXPO_PUBLIC_HF_TOKEN=hf_...
```

## Release keystore

A release keystore is required to sign the APK/AAB for Play Console.

1. Generate once: `keytool -genkey -v -keystore release.jks -alias localguide -keyalg RSA -keysize 2048 -validity 10000`
2. Store it securely outside the repo.
3. Point `android/app/build.gradle` at it via `android/keystore.properties` (create this file, gitignored):
   ```
   storeFile=/absolute/path/to/release.jks
   storePassword=...
   keyAlias=localguide
   keyPassword=...
   ```

## Building a release AAB

```bash
cd android
./gradlew bundleRelease -PMAPS_API_KEY=AIza...
```

The output is at `android/app/build/outputs/bundle/release/app-release.aab`.

## Publishing to Play Console

1. Upload the AAB to **Internal Testing** track first.
2. Wait for the **Pre-launch report** (automated device crawl) — fix any crashes before promoting.
3. Once the pre-launch report is green, promote to **Production** via a staged rollout (e.g. 10% → 50% → 100%).

## First-run checklist before Production push

- [ ] Pre-launch report shows no crashes on API 28+ devices
- [ ] Model download completes on a fresh install (no cached files)
- [ ] Location permission prompt appears correctly on first launch
- [ ] Privacy Policy URL is live and matches `PRIVACY.md`
- [ ] Content rating questionnaire completed in Play Console (generative AI disclosure)
