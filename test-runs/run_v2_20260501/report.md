# LocalGuide6 — Pixel 3 v2 verification (2026-05-01 ~20:30)

**Build:** main HEAD `f129658` (post-fix for the geosearch coords gap)
**Scope:** verify the four user-requested home changes + the four bugs found in the original e2e run

## Summary

| # | Feature | Expected | Actual | Status |
|---|---|---|---|---|
| **G9** | DwellBanner removed | No "You've been here a while" prompt anywhere | Confirmed — no banner in any screenshot | PASS |
| **G7** | No slow-device banner pre-LLM | Pure source-first chat shows no "Heads up" notice | V10: Stanford Memorial Church reply → no banner | PASS |
| **G8** | Slow-device banner appears with LLM | Banner shows once an `ai-online`/`ai-offline` bubble lands | V5: tile-tapped POI → 🧠 AI bubble → banner present | PASS |
| **B8** | Around-You cap=10, sorted by interest | ≤ 10 POIs ordered by Wikipedia article length | V3+V3_scrolled: exactly 10 (HP first @ 129K bytes) | PASS |
| **B9** | Distance accuracy | Real haversine to current GPS, no stale 0 m | V3: 1.1 km / 1.2 km / 1.6 km / 1.4 km / 644 m / etc. | PASS *(after PoiService coords-enrichment fix)* |
| **Bug 4** | Wiki summary not truncated mid-name | "Charles A. Coolidge" preserved | V10: full 3rd sentence including "called 'the University's architectural crown jewel'" | PASS |

## Bug found and fixed during v2 verification

**B9 was failing on first install** — every distance read "0 m". Root cause: MediaWiki's `prop=coordinates` only returns coords for ~33% of pages when paired with `generator=geosearch`, even when the pages have valid primary coords (HP, Matadero Creek, Baumé all affected). The existing fallback placed coordless pages at the user's GPS, producing the false 0 m.

Fix in `PoiService.fetchNearby` (commit `f129658`):
1. Detect pages that came back without coords.
2. Issue a follow-up `prop=coordinates` call keyed on those pageids.
3. Drop pages that are still coord-less rather than fall through to the GPS placeholder.
4. Two new tests (`PoiService.test.ts`) cover the enrichment merge and the strict-drop fallback.

## Screenshot index

- `V1_initial.png` — first install, all distances 0 m (pre-fix)
- `V2_scrolled.png` — list end visible, exactly 10 POIs (cap verified)
- `V3_post_fix.png` — second install, distances now real
- `V3_scrolled.png` — bottom of list, all 10 POIs with non-zero distances
- `V5_source_first.png` — tile-tap → 🧠 AI bubble + Heads up banner (G8)
- `V6_back_home.png` — chat cleared, banner gone again
- `V7_source_only.png` — accidental camera launch (back chevron mistapped)
- `V9_relaunch.png` — clean home with input prefilled
- `V10_source_first.png` — Stanford Memorial Church Wikipedia reply, no banner (G7), full 3 sentences (Bug 4 fix)

## All commits

- `a3b6367` feat(home): remove DwellBanner / "you've been here a while" prompt
- `f4e28bd` feat(home): rank around-you by interest, cap at 10, gate notices on LLM
- `f129658` fix(poi): rescue Wikipedia POIs the geosearch generator dropped coords for
- `4071feb` fix(modals): invalidate cached itinerary/quiz on mode change *(from prior round)*
- `47bc931` fix(wiki): don't split Wikipedia summary mid-name on initials *(from prior round)*

## Tests

- 7 new unit tests in `src/__tests__/poiRanking.test.ts` (sort/cap/hidden-gems/median-fill/live-distance/null-gps/cap-override)
- 2 new unit tests in `src/__tests__/PoiService.test.ts` (coords enrichment, strict drop)
- DwellBanner + useDwellDetection tests deleted (~9 tests)
- All other tests still green (DevicePerf failure in full-suite run is a pre-existing test-isolation flake; passes in isolation)
