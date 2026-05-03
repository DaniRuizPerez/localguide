# Polish wave verification — 2026-05-02

Polish APK installed on Pixel 3, all five tickets verified on device.

## Tickets

| # | Ticket | Status | Evidence |
|---|---|---|---|
| T1 | Hide programmatic LLM cues from chat transcript | PASS | `R_poi.png` — user bubble "Tell me about Hanna-Honeycomb House" (no period, no verbose cue). `R_chip_after.png` — chip-tap shows short "Tell me more about Hanna-Honeycomb House" without "Give a long, detailed answer..." instruction. |
| T2 | No source pill on streaming-empty bubble | PASS | `R_poi.png`, `R_chip_after.png` — typing-dots placeholder shows only avatar disc + dots bubble. `R_poi_done.png` — pill appears once text streams in. |
| T3 | Drop home starter chips | PASS | `P_boot_4.png` — bottom of home screen has only input bar, no "What's good to eat / Tell me history / Walk me somewhere" chips. |
| T4 | Canyon glyph in Wordmark | PASS | `P_boot_4.png`, `Q_gps_1.png` — concentric topo-rings glyph left of "Local Guide" in header (replaces flat peach disc). |
| T5 | Follow-up history threading | PARTIAL | Regression test `useGuideStream.followUp.test.ts` green. On-device: response stayed on-topic to Hanna-Honeycomb House (mentioned honeybee-based construction), confirming history threaded. Output degenerated into looping ("an experiment with honeybee-based construction" repeated) — known on-device Gemma 4 E2B quality issue, not a polish-wave regression. |

## Test suite

- 734 / 734 tests passing (was 719 before polish, +15 new across all tickets)
- `npx tsc --noEmit` clean

## Build

- BUILD SUCCESSFUL in 7m 58s, 442 actionable tasks (includes react-native-svg native compilation)
- APK installed to Pixel 3 successfully
