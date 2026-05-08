# Canyon — exported app icons

All exported from the same vector source as a 1024×1024 master.

## Use these where

| File | Where it goes |
|---|---|
| canyon-1024.png | App Store master / Expo `app.json` icon. |
| canyon-512.png | Play Store listing artwork. |
| canyon-android-foreground-432.png | Android adaptive icon foreground (see Expo `adaptiveIcon.foregroundImage`). |
| canyon-android-background-432.png | Adaptive icon background. Or, in `app.json`, set `adaptiveIcon.backgroundColor: "#E8845C"` and skip this image. |
| canyon-180.png … canyon-40.png | iOS density buckets (Expo will derive these from the 1024 master automatically — these are here in case you need them manually). |
| canyon-header-28/56/84.png | In-app brand mark for the chat header (`ModeHeader`). 1×/2×/3× for React Native `Image`. |

## Expo `app.json` snippet

```json
{
  "expo": {
    "icon": "./assets/canyon-1024.png",
    "ios": {
      "icon": "./assets/canyon-1024.png"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/canyon-android-foreground-432.png",
        "backgroundColor": "#E8845C"
      }
    }
  }
}
```

## In-app mark

```tsx
import CanyonIcon from './assets/canyon-header-84.png';

<Image source={CanyonIcon} style={{ width: 28, height: 28 }} />
```

React Native auto-picks the @2x / @3x variants if you name them
`canyon-header.png`, `canyon-header@2x.png`, `canyon-header@3x.png` —
rename if you prefer that convention.
