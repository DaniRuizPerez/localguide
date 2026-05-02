# LocalGuide6 — Pixel 3 Redesign verification (2026-05-02 ~12:00–12:25)

**Build:** main HEAD `d79f59f` (merge of T1–T5 redesign branches).

**Scope:** verify the 5-ticket redesign — canyon icon, restyled connection pill, "How should I answer?" pull-up sheet, Tell-me-more chips under every guide bubble, ModeChangeToast on online/offline transitions.

## Result

| # | Feature | Outcome |
|---|---|---|
| **T1** | Canyon (LogoC) icon | `assets/icon.png` (`icon_thumb.png`) renders the topo-rings + center dot + N/S ticks correctly. The Pixel 3 launcher cached the old peach-diamond icon (visible in app switcher); a device reboot or launcher cache refresh would surface the new icon. The asset itself is correct. |
| **T2** | Restyled ConnectionPill | Soft-tactile pill with 6×6 green dot (`#4ea374`) + Nunito 700 "Online" text visible in `RC_pill_dot_tap.png`. Tap callback fires. |
| **T3** | HowShouldIAnswerSheet | Tap on the green pill at native (466, 138) opens the bottom sheet. Title "How should I answer?", subhead "Three plain-English choices", three radio rows: Automatic / Online — grounded / Offline — on-device. Selecting an option closes the sheet and persists `guidePrefs.modeChoice`. |
| **T4** | Tell-me-more chips | After sending "Tell me about Stanford", the guide replies via the source-first Wikipedia path (249 ms · 📖). Three chips appear directly under the bubble: **Tell me more · Walk me there · Food nearby** (`RI_response.png`). Persist on every guide bubble (verified by sending another message — chips remain on the prior bubble too). |
| **T5** | ModeChangeToast | Selecting "Offline — on-device" from the sheet flips the pill amber AND shows a transient toast at the bottom: **"Switched to offline. Some answers may be inaccurate."** (`RK_offline_toast.png`). Auto-dismisses after 4 s. The persistent OfflineNotice strip also lives at the top — they don't stack visually. |

All 721 unit tests pass (was 687; +34 new). tsc clean.

## Bug surfaced + fixed during the session

**Stale Metro cache** — Metro had been started earlier in the session with the pre-merge code; debug APKs pull JS from Metro at runtime, so the first install was running pre-merge JS. Killed the stale Metro PID, restarted with `--reset-cache`, force-stopped + relaunched the app. After that, the pill tap correctly opened the new sheet.

## Screenshots

- `RC_pill_dot_tap.png` — sheet open showing all three plain-English choices (Offline currently selected).
- `RD_auto_selected.png` — after picking Automatic, sheet closes, pill green again.
- `RH_after_kb.png` — input bar with "Tell me about Stanford" typed.
- `RI_response.png` — guide reply (Wikipedia, 249 ms) with **Tell me more · Walk me there · Food nearby** chips beneath.
- `RJ_sheet_chat.png` — sheet re-opened from the chat header pill (verifies it works in both home and chat states).
- `RK_offline_toast.png` — after picking Offline, the amber **"Switched to offline. Some answers may be inaccurate."** toast appears above the input bar.
- `icon_thumb.png` — canyon LogoC topo-rings rendered onto `assets/icon.png` (peach `#E8845C` on cream `#F8F5F0`).

## Commits on `main`

- `4f4b5cd` feat(icon): canyon (LogoC) topo-rings as the app icon
- `06c1a30` feat(header): soft-tactile ConnectionPill restyle + onPress
- `924f8d5` feat(mode): HowShouldIAnswer pull-up sheet + ChatScreen wiring
- `249c01b` feat(chat): SuggestionChips under every guide bubble
- `10e445d` feat(mode): ModeChangeToast on online/offline transitions
- Plus the merge commits `de4a2f1` `976b769` `d826ef1` `e920ff1` `d79f59f`

## Tests added by the swarm

- `ConnectionPill.test.tsx` — +5 tests (style + onPress)
- `HowShouldIAnswerSheet.test.tsx` — 8 new
- `SuggestionChips.test.tsx` — 13 new (component + MessageList integration)
- `ModeChangeToast.test.tsx` — 8 new

Total: +34 tests; full suite 721/721 green.

## Open follow-ups

- The Pixel 3 launcher cached the prior icon; a `pm clear com.google.android.apps.nexuslauncher` or device reboot will surface the canyon icon. Not a code issue.
- Hydration race noted earlier (`08aa3d7`) is fixed; no recurrence in this run.
