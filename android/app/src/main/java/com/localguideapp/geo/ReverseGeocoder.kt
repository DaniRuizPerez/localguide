package com.localguideapp.geo

import android.database.sqlite.SQLiteDatabase
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Geohash-bucketed nearest-place lookup.
 *
 * Strategy:
 *  1. Encode (lat, lon) at precision 5 (~5 km cell).
 *  2. Take the surrounding 5×5 block (radius=2 → ≈25 km worst-case search).
 *  3. SELECT all places whose `geohash5` falls in that block.
 *  4. Rank by Haversine distance and return the closest.
 *
 * If a country pack is installed and yields a match within
 * [PACK_PREFERENCE_RADIUS_M], we prefer it over cities15000 — country packs
 * include towns/villages below the 15 k population cutoff. Otherwise we fall
 * through to cities15000.
 */
internal class ReverseGeocoder(private val geoDb: GeoDatabase) {

    suspend fun nearest(
        lat: Double,
        lon: Double,
        preferCountryPack: Boolean,
    ): Match? {
        val cell = Geohash.encode(lat, lon, 5)
        val cells = Geohash.neighborBlock(cell, radius = 2)

        // Try every installed country pack first. Cheap because each pack is
        // typically <50 MB and the geohash5 index makes the lookup O(log N).
        // We pick the closest hit across all packs that beats the threshold.
        if (preferCountryPack) {
            var best: Match? = null
            for (pack in geoDb.listInstalledPacks()) {
                val db = geoDb.openCountryPack(pack.iso) ?: continue
                val candidate = queryNearest(db, lat, lon, cells, source = "country:${pack.iso}")
                val current = best
                if (candidate != null && (current == null || candidate.distanceMeters < current.distanceMeters)) {
                    best = candidate
                }
            }
            val finalBest = best
            if (finalBest != null && finalBest.distanceMeters <= PACK_PREFERENCE_RADIUS_M) {
                return finalBest
            }
        }

        // Fall back to the global cities15000 DB.
        val cities = geoDb.openCities()
        return queryNearest(cities, lat, lon, cells, source = "cities15000")
    }

    private fun queryNearest(
        db: SQLiteDatabase,
        lat: Double,
        lon: Double,
        cells: List<String>,
        source: String,
    ): Match? {
        if (cells.isEmpty()) return null
        val placeholders = cells.joinToString(",") { "?" }
        // LEFT JOIN countries + admin1 so we get human-readable names when the
        // pack ships them. Country packs and cities15000 share the exact same
        // schema, so this query is uniform across both.
        val sql = """
            SELECT p.geonameid, p.name, p.asciiname, p.country_code, p.admin1, p.admin2,
                   p.feature_code, p.population, p.lat, p.lon,
                   c.name AS country_name,
                   a.name AS admin1_name
            FROM places p
            LEFT JOIN countries c ON c.iso = p.country_code
            LEFT JOIN admin1    a ON a.country_code = p.country_code AND a.code = p.admin1
            WHERE p.geohash5 IN ($placeholders)
        """.trimIndent()
        var best: Match? = null
        db.rawQuery(sql, cells.toTypedArray()).use { cur ->
            val iName = cur.getColumnIndexOrThrow("name")
            val iAscii = cur.getColumnIndexOrThrow("asciiname")
            val iCc = cur.getColumnIndexOrThrow("country_code")
            val iAdmin1 = cur.getColumnIndexOrThrow("admin1")
            val iAdmin2 = cur.getColumnIndexOrThrow("admin2")
            val iFc = cur.getColumnIndexOrThrow("feature_code")
            val iPop = cur.getColumnIndexOrThrow("population")
            val iLat = cur.getColumnIndexOrThrow("lat")
            val iLon = cur.getColumnIndexOrThrow("lon")
            val iCountry = cur.getColumnIndexOrThrow("country_name")
            val iA1Name = cur.getColumnIndexOrThrow("admin1_name")
            while (cur.moveToNext()) {
                val pLat = cur.getDouble(iLat)
                val pLon = cur.getDouble(iLon)
                val d = haversineMeters(lat, lon, pLat, pLon)
                val current = best
                if (current == null || d < current.distanceMeters) {
                    best = Match(
                        name = cur.getString(iName).orEmpty(),
                        asciiname = cur.getString(iAscii).orEmpty(),
                        admin1 = cur.getString(iAdmin1),
                        admin1Name = cur.getString(iA1Name),
                        admin2 = cur.getString(iAdmin2),
                        countryCode = cur.getString(iCc).orEmpty(),
                        countryName = cur.getString(iCountry),
                        featureCode = cur.getString(iFc),
                        population = if (cur.isNull(iPop)) 0 else cur.getInt(iPop),
                        lat = pLat,
                        lon = pLon,
                        distanceMeters = d,
                        source = source,
                    )
                }
            }
        }
        return best
    }

    data class Match(
        val name: String,
        val asciiname: String,
        val admin1: String?,
        val admin1Name: String?,
        val admin2: String?,
        val countryCode: String,
        val countryName: String?,
        val featureCode: String?,
        val population: Int,
        val lat: Double,
        val lon: Double,
        val distanceMeters: Double,
        val source: String,
    )

    companion object {
        /** When a country pack hit is within 50 km, prefer it over cities15000. */
        const val PACK_PREFERENCE_RADIUS_M = 50_000.0

        /** Haversine great-circle distance in meters. */
        fun haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6_371_000.0 // Earth radius (m)
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLon / 2) * sin(dLon / 2)
            // `a` is mathematically in [0, 1] but rounding can leave it just over 1.0,
            // which would NaN sqrt(1 - a). Clamp before sqrt for robustness.
            val aClamped = a.coerceIn(0.0, 1.0)
            val c = 2 * atan2(sqrt(aClamped), sqrt(1.0 - aClamped))
            return r * c
        }
    }
}
