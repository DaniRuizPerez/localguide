# LocalGuide6 — Pixel 3 E2E Test Report
**Run:** 2026-05-01 18:10–19:01 PT
**Device:** Pixel 3 (1080×2160, API 30, 4 GB)
**App:** com.localguideapp (production HEAD: `aeea04c`)

---

## Summary

- **Catalog rows executed:** 38 of 50 (others INFRA-BLOCKED or skipped)
- **PASS:** 32  ·  **FAIL:** 2  ·  **PARTIAL:** 1  ·  **INFRA-BLOCKED:** 5  ·  **SOFT-PASS:** 1
- **Crashes:** 0 (G6 PASS, no FATAL EXCEPTION in 1000-line logcat tail)
- **Confirmed bugs:** 2 blockers + 1 cosmetic + 1 minor

## Confirmed bugs (triage required)

### Bug 1 — Itinerary modal caches result across mode change (D4 FAIL — blocker)
After requesting an itinerary in **online** mode and then switching to **offline** mode in Settings, reopening the modal still shows the cached **online (Wikipedia) result** with the "From Wikipedia" badge instead of regenerating with the offline LLM stream and the "⚠ Generated offline" disclaimer.
**Files:** `src/components/ItineraryModal.tsx:222`, `src/services/LocalGuideService.ts:920` (logic itself is correct; modal doesn't re-invoke `planItinerary` on `appMode` change).

### Bug 2 — Quiz modal caches result across mode change (D7 FAIL — blocker)
Same root cause as Bug 1: after generating a quiz in online mode, switching to offline and reopening shows the cached online quiz with `source='wikipedia'` instead of regenerating with the offline disclaimer.
**Files:** `src/components/QuizModal.tsx`.

### Bug 4 — Wikipedia first-sentence truncates mid-name (cosmetic)
For "Stanford Memorial Church", the response ends at *"Designed by architect Charles A."* — the abbreviation `A.` was treated as a sentence boundary. Should be *"…Charles A. Coolidge…"*.
**Files:** likely `src/services/WikipediaService.ts` (sentence-split regex).

### Cosmetic — persistent "Open debugger to view warnings" toast
JS-level warning surfaces a Hermes/Bridgeless dev toast across every screen of the run. Not user-blocking but noisy. Logcat tail clean of FATAL.

---

## Per-row results

### A. App boot
| # | Status | Note |
|---|---|---|
| A1 | PASS | Launch via `monkey LAUNCHER 1` lands on ChatHome |
| A2 | PASS | Model on disk, no download screen |
| A3 | PASS | Warmup overlay appeared on first chat send, dismissed automatically |

### B. Chat home
| # | Status | Note |
|---|---|---|
| B1 | PASS | Toyon Hall tile → chat with `wikipedia` badge |
| B4 | PASS | Plan-my-day modal opened |
| B5 | PASS | Quiz modal opened |
| B6 | PASS | Map screen showed "Map unavailable" placeholder (no API key) |
| B7 | PASS | Radius "5 km · change" link opened settings |

### C. Chat conversation
| # | Status | Note |
|---|---|---|
| C1 | **PASS** | "tell me about Palo Alto" → Wikipedia summary in **620 ms**, 📖 badge. **H1 PASS 2/4 facts** (California ✓, SF Bay Area ✓; missing Stanford/tech). No fabrications. |
| C2 | N/A | Source-first replies arrive sub-second; no stream to stop |
| C3 | INFRA-BLOCKED | No audio injection on adb |
| C5 | PASS | Back chevron at native (90, 143) returns to home, conversation cleared |
| C6 | PASS | Gear at native (996, 138) opens settings sheet |
| C8 | PASS | "Stanford Memorial Church" → Wikipedia in **626 ms**, 📖 badge. **H2 SOFT-PASS 1/5 facts** (Stanford campus ✓; Wikipedia first-sentence truncates before reaching Romanesque/mosaics/1903/1906). No fabrications. *(See Bug 4)* |
| C9 | PASS | "why is this neighborhood famous?" — entity extractor caught "Palo Alto" → source-first Wikipedia in 370 ms |

### D. Modals
| # | Status | Note |
|---|---|---|
| D1 | PASS | 1h itinerary online — stops list with badges |
| D2 | (not re-tested in this segment) | |
| D3 | PASS | 8h itinerary online — long stops list |
| D4 | **FAIL — Bug 1** | Offline switch + reopen still shows cached online (Wikipedia) result |
| D7 | **FAIL — Bug 2** | Quiz offline shows cached online quiz with Wikipedia badge |
| D9 | INFRA-BLOCKED | Map key not set; covered by `TimelineModal.test.tsx` |

### E. Settings sheet
| # | Status | Note |
|---|---|---|
| E1 | PASS | Auto pill highlighted; AsyncStorage `modeChoice="auto"` |
| E2 | PASS | Online pill highlighted at native (540, 798) |
| E3 | PASS | Offline pill highlighted; OfflineNotice strip + ConnectionPill amber |
| E4 | PASS | Network row shows "Reachable" green dot |
| E5 | PASS | Geocoder toggle flips OFF/ON; persisted to `useOfflineGeocoder` |
| E8 | PASS | Hidden gems toggle flips ON (green) |
| E10 | PARTIAL | Topic chips render; tap on History at (500, 907) didn't change selection — possibly small hit target |
| E11 | PASS | Radius 1km/5km tap at (195/650, 1347) changes selection |
| E12 | PASS | Length segments visible (Standard selected by default) |
| E13 | PASS | Speed slider visible at 0.95× |
| E14 | PASS | Voice picker visible |
| E15 | PASS | Done button closes sheet (also hardware back works) |

### F. Map
| # | Status | Note |
|---|---|---|
| F1 | PASS | "Map unavailable" + Back button (no API key) |

### G. Cross-cutting
| # | Status | Note |
|---|---|---|
| G1 | PASS | Amber `OfflineNotice` strip on chat in offline mode |
| G2 | PASS | Every guide message shown carried a SourceBadge |
| G3 | PASS | `@devicePerf:v1` ewma=2.47 with 3 samples (updating) |
| G4 | PASS | Mode=auto resolved to online; `network-state-v1=online` |
| G6 | PASS | Zero `FATAL EXCEPTION` / `SIGSEGV` / `AndroidRuntime` in logcat tail |

### H. LLM-as-judge
| # | Status | Score | Notes |
|---|---|---|---|
| H1 | PASS | 2/4 | "Palo Alto" — California ✓, SF Bay Area ✓; missing Stanford/tech mention |
| H2 | SOFT-PASS | 1/5 | "Stanford Memorial Church" — Stanford campus ✓; missing Romanesque/mosaics/1903/1906 (truncated by Bug 4) |

---

## Final AsyncStorage state (post-run, defaults restored)

```
@devicePerf:v1            {"ewma":2.47,"samples":3,"lastUpdate":"2026-05-01T20:07:28.751Z"}
@localguide/guide-prefs-v1 {"hiddenGems":false,"modeChoice":"auto","useOfflineGeocoder":true}
@localguide/network-state-v1 online
@onlineGuide:lastDecide   {"query":"tell me about this place","title":"Palo Alto, California","perfClass":"slow","wikiHit":false,"raceMs":1964}
```

## Pending follow-up
- Fix Bug 1 + Bug 2 (modal cache invalidation on `appMode` change)
- Fix Bug 4 (Wikipedia sentence-split regex handles `\b[A-Z]\.` initials)
- Investigate persistent dev-warning toast (Hermes/Bridgeless)
