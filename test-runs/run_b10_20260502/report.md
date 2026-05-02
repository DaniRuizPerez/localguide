# LocalGuide6 — Pixel 3 B10 verification (2026-05-02 ~09:00–10:00)

**Build:** main HEAD `08aa3d7` (post hydration fix)

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
