package com.ai_offline_tourguide.geo

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/**
 * RN-facing bridge for the offline reverse-geocoder.
 *
 * Bridge contract documented in the spec — every method below corresponds to a
 * promise-returning JS call. Heavy work (SQLite I/O, downloads, gunzip) happens
 * on [scope], a `Dispatchers.IO` supervisor scope so a failure in one method
 * never tears down the others.
 *
 * One `GeoDatabase` instance is shared across calls and caches its open
 * connections; one `LocationProvider` and one `CountryPackDownloader` are also
 * shared and stateless.
 */
@ReactModule(name = GeoModule.NAME)
class GeoModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val geoDb = GeoDatabase(reactContext)
    private val geocoder = ReverseGeocoder(geoDb)
    private val locationProvider = LocationProvider(reactContext)
    private val downloader = CountryPackDownloader(geoDb)

    override fun getName(): String = NAME

    // ---------------------------------------------------------------------- //
    // 1. reverseGeocode
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun reverseGeocode(lat: Double, lon: Double, options: ReadableMap?, promise: Promise) {
        val preferCountryPack = options?.takeIfHas("preferCountryPack")?.getBoolean("preferCountryPack") ?: true
        scope.launch {
            try {
                val match = geocoder.nearest(lat, lon, preferCountryPack)
                if (match == null) {
                    promise.resolve(null)
                    return@launch
                }
                promise.resolve(match.toWritableMap())
            } catch (t: Throwable) {
                promise.reject("E_REVERSE_GEOCODE", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    private fun ReverseGeocoder.Match.toWritableMap(): WritableMap = Arguments.createMap().apply {
        // geonameid is a Long; WritableMap doesn't have putLong, so JS sees it
        // as a number (safe — geonameids fit comfortably in 53 bits).
        putDouble("geonameid", geonameid.toDouble())
        putString("name", name)
        putString("asciiname", asciiname)
        if (admin1 != null) putString("admin1", admin1) else putNull("admin1")
        if (admin1Name != null) putString("admin1Name", admin1Name) else putNull("admin1Name")
        if (admin2 != null) putString("admin2", admin2) else putNull("admin2")
        putString("countryCode", countryCode)
        if (countryName != null) putString("countryName", countryName) else putNull("countryName")
        if (featureCode != null) putString("featureCode", featureCode) else putNull("featureCode")
        putInt("population", population)
        putDouble("lat", lat)
        putDouble("lon", lon)
        putDouble("distanceMeters", distanceMeters)
        putString("source", source)
    }

    // ---------------------------------------------------------------------- //
    // 1b. nearbyPlaces (offline POI list)
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun nearbyPlaces(lat: Double, lon: Double, radiusMeters: Double, limit: Int, promise: Promise) {
        val safeLimit = limit.coerceIn(1, 200)
        val safeRadius = radiusMeters.coerceIn(10.0, 50_000.0)
        scope.launch {
            try {
                val matches = geocoder.nearbyPlaces(lat, lon, safeRadius, safeLimit)
                val arr = Arguments.createArray()
                for (m in matches) arr.pushMap(m.toWritableMap())
                promise.resolve(arr)
            } catch (t: Throwable) {
                promise.reject("E_NEARBY_PLACES", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // 1c. searchByName (forward geocode against on-device DB)
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun searchByName(query: String, limit: Int, promise: Promise) {
        val safeLimit = limit.coerceIn(1, 50)
        scope.launch {
            try {
                val matches = geocoder.searchByName(query, safeLimit)
                val arr = Arguments.createArray()
                for (m in matches) arr.pushMap(m.toWritableMap())
                promise.resolve(arr)
            } catch (t: Throwable) {
                promise.reject("E_SEARCH_BY_NAME", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // 2. getCurrentLocation
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun getCurrentLocation(options: ReadableMap?, promise: Promise) {
        val priority = LocationProvider.PriorityHint.parse(
            options?.takeIfHas("priority")?.getString("priority")
        )
        val maxAgeMs = options?.takeIfHas("maxAgeMs")?.getInt("maxAgeMs")?.toLong() ?: 60_000L

        if (!locationProvider.hasPermission()) {
            promise.reject("E_PERMISSION", "Missing FINE/COARSE location permission")
            return
        }

        scope.launch {
            try {
                val fix = locationProvider.getCurrentLocation(priority, maxAgeMs)
                val map = Arguments.createMap().apply {
                    putDouble("lat", fix.lat)
                    putDouble("lon", fix.lon)
                    putDouble("accuracyMeters", fix.accuracyMeters)
                    // ageMs can exceed Int range (long-running last-known); use double
                    // since WritableMap doesn't have putLong. JS will coerce to number.
                    putDouble("ageMs", fix.ageMs.toDouble())
                    putString("provider", fix.provider)
                }
                promise.resolve(map)
            } catch (sec: SecurityException) {
                promise.reject("E_PERMISSION", sec.message ?: "Permission denied", sec)
            } catch (t: Throwable) {
                promise.reject("E_LOCATION", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // 3. availableCountryPacks
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun availableCountryPacks(promise: Promise) {
        // TODO(remove-by 2026-05-26): the JS layer fetches the GitHub Releases
        // catalog itself in this first cut. Once we move the catalog source of
        // truth native-side (so background sync can use it), populate this from
        // a cached JSON in `filesDir/geo/catalog.json` and a periodic WorkManager
        // refresh. For now, return an empty array.
        promise.resolve(Arguments.createArray())
    }

    // ---------------------------------------------------------------------- //
    // 4. installedCountryPacks
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun installedCountryPacks(promise: Promise) {
        scope.launch {
            try {
                val arr = Arguments.createArray()
                for (p in geoDb.listInstalledPacks()) {
                    val m = Arguments.createMap().apply {
                        putString("iso", p.iso)
                        putString("snapshotDate", p.snapshotDate)
                        putDouble("sizeBytes", p.sizeBytes.toDouble())
                    }
                    arr.pushMap(m)
                }
                promise.resolve(arr)
            } catch (t: Throwable) {
                promise.reject("E_LIST_PACKS", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // 5. installCountryPack
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun installCountryPack(
        iso: String,
        downloadUrl: String,
        expectedSnapshotDate: String,
        promise: Promise,
    ) {
        scope.launch {
            try {
                downloader.install(iso, downloadUrl, expectedSnapshotDate) { phase, bytesDl, bytesTotal ->
                    val payload = Arguments.createMap().apply {
                        putString("iso", iso.uppercase())
                        putString("phase", phase)
                        if (phase == "download") {
                            putDouble("bytesDownloaded", bytesDl.toDouble())
                            putDouble("bytesTotal", bytesTotal.toDouble())
                        }
                    }
                    emit(EVENT_PROGRESS, payload)
                }
                emit(EVENT_COMPLETE, Arguments.createMap().apply {
                    putString("iso", iso.uppercase())
                    putString("snapshotDate", expectedSnapshotDate)
                    putDouble("sizeBytes", File(geoDb.geoDir(), "${iso.uppercase()}.db").length().toDouble())
                })
                promise.resolve(null)
            } catch (t: Throwable) {
                emit(EVENT_ERROR, Arguments.createMap().apply {
                    putString("iso", iso.uppercase())
                    putString("message", t.message ?: t.javaClass.simpleName)
                })
                promise.reject("E_INSTALL_PACK", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // 6. uninstallCountryPack
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun uninstallCountryPack(iso: String, promise: Promise) {
        scope.launch {
            try {
                val ok = geoDb.uninstallPack(iso)
                promise.resolve(ok)
            } catch (t: Throwable) {
                promise.reject("E_UNINSTALL_PACK", t.message ?: t.javaClass.simpleName, t)
            }
        }
    }

    // ---------------------------------------------------------------------- //
    // RCTEventEmitter parity (RN warns without these)
    // ---------------------------------------------------------------------- //

    @ReactMethod
    fun addListener(eventName: String) { /* no-op */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* no-op */ }

    // ---------------------------------------------------------------------- //
    // Internals
    // ---------------------------------------------------------------------- //

    private fun emit(eventName: String, payload: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    /**
     * `ReadableMap` lacks a single "get if present and not null" helper; this
     * wraps the two-step check so call sites stay compact.
     */
    private fun ReadableMap.takeIfHas(key: String): ReadableMap? =
        if (hasKey(key) && !isNull(key)) this else null

    companion object {
        const val NAME = "GeoModule"
        const val EVENT_PROGRESS = "GeoPackProgress"
        const val EVENT_ERROR = "GeoPackError"
        const val EVENT_COMPLETE = "GeoPackComplete"
    }
}
