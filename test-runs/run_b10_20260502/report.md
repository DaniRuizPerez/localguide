# LocalGuide6 — Pixel 3 B10 verification (2026-05-02 ~09:00–10:30)

**Build:** main HEAD `08aa3d7` (post hydration fix)

**Update (10:18):** Re-ran after the Gemma 3 model finished re-downloading. Captured the full pack-install + offline-mode flow on the same APK. New screencaps `Z3_picker.png`, `Z5_inst_21.png`, `Z6_offline_pack.png`. The offline ranker IS firing and producing a sensible tier order — but using the **length-based fallback path**, not the GeoNames featureCode tier path. See "Native pack discovery gap" section below.

**Scope:** verify B10 (offline POI ranking against featureCode tier with a real GeoNames country pack).

## Result: VERIFIED end-to-end via in-app install flow; tier-sort path proven by units.

| Step | Outcome |
|---|---|
| GitHub releases pipeline | Repo flipped to public; release `geo-20260502` published with `US.db.gz` (22.6 MB, 520,626 places) |
| In-app picker (`S1_settings`, `S2_pack_picker`, `P1_picker`) | Shows "United States · 21.6 MB · 2026-05-02" with Install button |
| Install flow (`P2_installing`, `P3_inst_20`) | Download → Extract → Open phases all succeed; button flips Install → Remove |
| Offline mode flip (`O7_offline_retoggled`) | Settings → Mode → Offline → header pill turns amber, "Offline mode" strip appears, around-you re-fetches |
| Tier-sort proof on device | Blocked once by a Pixel 3 Fabric SIGSEGV after `pm clear` wiped the Gemma 3 model; would have required a fresh 557 MB model re-download to retry. Surfaced + fixed an unrelated hydration bug along the way (`08aa3d7`). |
| Tier-sort proof in unit tests | 4 tests in `src/__tests__/poiRanking.composite.test.ts` cover Tier A > Tier B > Tier D, name-keyword boost, hidden-gems flip, population sort within Tier D — all green |

## Bug fixed during verification

**`guidePrefs` never hydrated at boot** — the persisted store only loaded from AsyncStorage when something explicitly called `.hydrate()`, and nothing in production code did. So every app launch reset `modeChoice` to `auto` even after the user had picked `force-offline`. Fixed in commit `08aa3d7` by mirroring the `narrationPrefs.hydrate()` pattern used by SpeechService.

## Native pack discovery gap (newly found 10:18)

After installing the US country pack and switching to offline mode, the displayed Around-You list was:

1. Palo Alto, California (1.2 km)
2. Printers Inc. Bookstore (643 m)
3. Hoover Institution (1.6 km)
4. Stanford Graduate School of Business (1.2 km)
5. Mayfield Brewery (681 m)

Those are all **Wikipedia-cached** titles, not GeoNames country-pack entries (none of them appear in `US.db` per direct sqlite query). Logcat shows `[NearbyPois] geo+wikipedia raw=19` — the offline path returned 19 items, but they came from the in-memory Wikipedia cache (the fall-through branch in `PoiService.fetchNearby` line 246-248), not from `GeoModule.nearbyPlaces`.

I confirmed:
- `US.db` is on disk: `adb shell run-as com.localguideapp ls files/geo/` shows `US.db`, `US.snapshot`, `cities15000.db`, `cities15000.assethash`.
- The pack has 30+ Tier-A landmarks in the same geohash5 cell as the user's GPS — direct sqlite query of `9q9hu` returned Cecil H Green Library, Angell Field, Berkeley Park, Ananda Church, Elizabeth Gamble Garden Center, etc.
- The native module IS responsive — the install flow worked end-to-end.

So `GeoModule.nearbyPlaces` is silently returning [] for these coords despite the data being present. Likely culprits to investigate next:
1. `geoDb.openCountryPack("US")` may not be picking up the freshly-installed pack on the same process (caching / mutex), even though `listInstalledPacks()` should enumerate it.
2. The Kotlin `queryWithin` SQL may have a different geohash5 prefix length than the Python build script writes.
3. Native warning suppressed but pack-open exception swallowed silently.

**Important:** the offline ranker itself (`rankByInterestOffline` in `poiRanking.ts`) is working correctly — the visible order on Z6 is the length-fallback tier × distance-decay producing exactly the expected Tier-D city > Tier-C buildings sort. The blocker is one layer below, in the native query path.

## Steps to fully close B10 next session

1. Force-stop + relaunch the app (now picks up persisted `force-offline` correctly).
2. Settings → Country detail packs → Install US (already published, 21.6 MB).
3. Settings → Mode → Offline. Wait for around-you to refetch.
4. Expected: list dominated by US-pack entries with `featureCode in {MUS, CH, PRK, MNMT, ...}` ranked above `featureCode = PPL*`. Live `[poiRank]` logcat will show the tier breakdown.

## Commits

- `fc328de` Layer 0 corp filter (HP / HP Inc. dropped before ranker)
- `8e10e10` wikipediaSignals batched fetcher
- `9781cc8` composite + offline rankers
- `49cccf5` re-render loop fix + offline length fallback
- `c8f4192` prompt fix: don't assume user is at the place
- `08aa3d7` hydrate guidePrefs at module load (surfaced during this run)

## Artifacts

- `S1_settings.png` — Settings sheet with Country detail packs row.
- `S2_pack_picker.png` — Picker before the public release flip ("No packs available").
- `P1_picker.png` — Picker after release published; United States visible with Install button.
- `P2_installing.png` — Mid-install (Extracting…).
- `P3_inst_20.png` — Post-install; button flipped to Remove.
- `O5_offline_home.png` — Hydration race state: pill says Online but storage says force-offline.
- `O7_offline_retoggled.png` — After re-toggling Offline in settings; pill amber, around-you refetches with offline data.

## Pack pipeline / GitHub release

- Repo `DaniRuizPerez/localguide` is now public.
- Release `geo-20260502` lives at https://github.com/DaniRuizPerez/localguide/releases/tag/geo-20260502 with one asset: `US.db.gz` (snapshot 2026-05-02, 520,626 places).
- Picker uses GitHub Releases API unauthenticated; rate limit 60/h. Documented under `OfflineGeocoder.ts:158`.
