# LocalGuide6 — Pixel 3 v3 verification (2026-05-02 ~07:55–08:05)

**Build:** main HEAD `49cccf5` (post-fix for the re-render loop + offline length fallback)

**Scope:** verify the new POI ranking — Layer-0 corp filter, online composite ranker, offline feature-code ranker.

## Summary

| # | Feature | Expected | Actual | Status |
|---|---|---|---|---|
| **B8** | Online: ≤10 POIs by composite interest, no corp HQs | HP / HP Inc. dropped by Layer-0; Hanna-Honeycomb House (catBoost=50) tops; cities (Palo Alto, Stanford) get high pageview lift; sports venues with description keywords (Klein Field, Stanford Field) surface | V4: list shows Hanna-Honeycomb House / Library / Palo Alto / Stanford / Hoover Institution / Klein Field / Stanford GSB / Stanford Field / Maples Pavilion / California Ave station — 10 POIs total, no HP / HP Inc. | PASS |
| **B9** | Distance accuracy | All distances 1.2–1.6 km (real) | Same — confirmed | PASS |
| **B10** | Offline: featureCode tier or length fallback | With country pack: Tier A landmarks first; without: length-based fallback per the new branch | V6: cached Wikipedia POIs render; V7 (post-reload): GeoNames cities-only path (Palo Alto / Menlo Park) — country pack not installed on this device, so featureCode tier path can't be exercised. Length-fallback path is unit-tested. | PARTIAL (tested via unit, no country pack on device) |
| **G7/G8** | Banner gating preserved | No banner pre-LLM, banner present after LLM bubble | Confirmed across V4, V8 — no regressions from earlier work | PASS |
| **No-loop check** | No "Maximum update depth exceeded" toast | First install (V2) hit the loop; reproduced in logcat as "ReactNativeJS: Maximum update depth exceeded"; deps fix in `49cccf5` resolved it; V4 onward clean | PASS (after fix) |

## poiRank breakdown (online, V4)

See `poirank_logcat.txt` for the full per-POI score breakdown captured from `adb logcat | grep poiRank`. Highlights:

| POI | catBoost | descBoost | langBoost | pvScore | corpPenalty | final |
|---|---|---|---|---|---|---|
| Hanna-Honeycomb House (Frank Lloyd Wright) | 50 | 20 | 0.5 | 31.0 | 0 | **56.20** |
| Palo Alto, California | 0 | 0 | 30 | 50 | 0 | 49.37 |
| Stanford, California | 0 | 0 | 27 | 43.2 | 0 | 40.19 |
| Klein Field at Sunken Diamond | 0 | 20 | 0 | 28.9 | 0 | 29.26 |
| Mayfield Brewery (penalised) | 0 | 0 | 0 | 20.0 | **40** | -15.22 |
| Printers Inc. Bookstore (penalised) | 0 | 0 | 0 | 22.6 | **40** | -13.46 |

Note that Mayfield Brewery and Printers Inc. Bookstore got the corp-category penalty and dropped out of the visible top 10 — exactly the design intent.

## Bug fixed during verification

**Maximum update depth exceeded** — the new useEffect-based ranker depended on the whole `gps` object, but `useLocation` returns a fresh reference on every render. Effect re-fired → setState → render → fresh gps → loop. Fixed by:
1. Splitting deps to `gps?.latitude` / `gps?.longitude` primitives.
2. Moving the sync paint back to `useMemo` (stable per-deps); only the async refinement uses `useState`.
3. Final value is `refinedPois ?? syncRanked`.

Plus: offline ranker collapsed to "all distance, no signal" when fed the stale Wikipedia cache (POIs without `featureCode`). Added a length-based tier fallback so the ranker still discriminates instead of sorting purely by proximity.

## Screenshot index

- `V1_initial.png` — first launch hit the "Unable to load script" Metro screen (adb reverse not yet active).
- `V2_after_metro.png` — first paint with new ranker; Layer-0 dropped HP/HP Inc.; "Maximum update depth" toast visible (loop bug).
- `V3_wait_*.png` — relaunch after fix, waiting for GPS lock.
- `V4_gps_18.png` — full Around-You list with composite ranking, no toast.
- `V5_scrolled.png` — scrolled view, exactly 10 POIs visible to the chip row.
- `V6_offline.png` — offline mode, stale Wikipedia cache renders.
- `V7_after_reload.png` — offline post-reload, only GeoNames cities (Palo Alto, Menlo Park) — country pack absent.
- `V8_back_online.png` — Auto tap missed segment row (offline notice strip pushed it down); state still offline; no further action needed for the scope.

## Commits

- `fc328de` feat(poi): drop corp-HQ pages in isTouristic before they reach the ranker
- `8e10e10` feat(poi): batched Wikipedia signals fetcher (categories + langlinks + pageviews)
- `9781cc8` feat(poi): composite online ranker + feature-code offline ranker
- `49cccf5` fix(poi): stop infinite re-render in ranker effect; add offline length fallback

## Tests

- `src/__tests__/PoiService.test.ts` — Layer-0 blocklist tests (HP / HP Inc. / Tesla dropped, Stanford Memorial Church kept).
- `src/__tests__/poiRanking.composite.test.ts` — 11 tests: HP de-rank, hidden-gems flip, confidence gate, empty-signals fallback, adaptive distance decay, offline tier ordering, name keyword boost, population sort within Tier D.
- `src/__tests__/wikipediaSignals.test.ts` — 7 tests: caching, batching at 50 ids, partial coverage, network error fallback, AbortController.
- Full suite: 686 / 686 passing.
