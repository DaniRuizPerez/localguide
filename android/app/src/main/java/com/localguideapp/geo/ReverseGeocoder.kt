package com.localguideapp.geo

import android.database.sqlite.SQLiteDatabase
import android.util.Log
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

    /**
     * Top-N places within `radiusMeters` of the query, ranked by distance.
     *
     * Used by the offline-mode POI chip list — instead of asking the LLM to
     * invent place names, we query the bundled cities15000 + every installed
     * country pack and return real, ranked-by-distance hits. Country packs
     * include parks and curated landmark codes, so for a city like Miami the
     * list surfaces neighborhoods, parks, and museums rather than the LLM's
     * hallucinated "12th Street Park."
     *
     * Dedup is by geonameid: the same place appearing in both cities15000
     * and an installed pack is counted once (the pack copy wins because it
     * carries richer metadata — feature_code, finer admin lineage).
     */
    suspend fun nearbyPlaces(
        lat: Double,
        lon: Double,
        radiusMeters: Double,
        limit: Int,
    ): List<Match> {
        if (limit <= 0 || radiusMeters <= 0) return emptyList()
        // 5x5 block ≈ 25 km coverage; enough for any practical chip-list
        // radius (the UI caps at 5 km today).
        val cell = Geohash.encode(lat, lon, 5)
        val cells = Geohash.neighborBlock(cell, radius = 2)
        Log.d("ReverseGeocoder", "nearbyPlaces lat=$lat lon=$lon r=${radiusMeters}m limit=$limit cell=$cell cells=${cells.size}")

        val byId = LinkedHashMap<Long, Match>()

        // Country packs first so their richer entries win the dedup race.
        val packs = geoDb.listInstalledPacks()
        Log.d("ReverseGeocoder", "  installedPacks=${packs.map { it.iso }}")
        for (pack in packs) {
            val db = geoDb.openCountryPack(pack.iso)
            if (db == null) { Log.w("ReverseGeocoder", "  pack ${pack.iso} openCountryPack returned null"); continue }
            val matches = queryWithin(db, lat, lon, cells, radiusMeters, "country:${pack.iso}")
            Log.d("ReverseGeocoder", "  pack ${pack.iso} → ${matches.size} matches within ${radiusMeters}m")
            for (m in matches) {
                if (!byId.containsKey(m.geonameid)) byId[m.geonameid] = m
            }
        }

        // Then the global cities table — dedup against pack hits above.
        val cities = geoDb.openCities()
        val cityMatches = queryWithin(cities, lat, lon, cells, radiusMeters, "cities15000")
        Log.d("ReverseGeocoder", "  cities15000 → ${cityMatches.size} matches within ${radiusMeters}m")
        for (m in cityMatches) {
            if (!byId.containsKey(m.geonameid)) byId[m.geonameid] = m
        }

        val result = byId.values.sortedBy { it.distanceMeters }.take(limit)
        Log.d("ReverseGeocoder", "  → returning ${result.size} (deduped, top $limit)")
        return result
    }

    /**
     * Forward-geocode a typed place name. Used when GPS is denied and the
     * user types something into the manual-location row. Searches every
     * installed country pack first (richer coverage — neighborhoods, parks)
     * and falls back to cities15000. Returns the highest-population match
     * because population is the only signal we have to disambiguate
     * collisions like "Springfield, MO" vs "Springfield, IL" — the user is
     * statistically more likely to have meant the bigger one.
     *
     * Match strategy: exact ascii name first (high confidence), then a
     * `LIKE` prefix on either name or ascii name. Diacritic-insensitive via
     * the `asciiname` column, which the importer pre-normalizes.
     */
    suspend fun searchByName(query: String, limit: Int): List<Match> {
        val safeLimit = limit.coerceAtLeast(1).coerceAtMost(50)
        val needle = query.trim()
        if (needle.isEmpty()) return emptyList()

        val byId = LinkedHashMap<Long, Match>()
        for (pack in geoDb.listInstalledPacks()) {
            val db = geoDb.openCountryPack(pack.iso) ?: continue
            for (m in queryByName(db, needle, safeLimit, "country:${pack.iso}")) {
                if (!byId.containsKey(m.geonameid)) byId[m.geonameid] = m
            }
        }
        val cities = geoDb.openCities()
        for (m in queryByName(cities, needle, safeLimit, "cities15000")) {
            if (!byId.containsKey(m.geonameid)) byId[m.geonameid] = m
        }

        // Population descending — exact matches still beat fuzzy matches
        // because queryByName surfaces them with a synthetic high-priority
        // tie-break (see the ORDER BY there).
        return byId.values.sortedWith(
            compareByDescending<Match> { exactScore(it, needle) }.thenByDescending { it.population }
        ).take(safeLimit)
    }

    private fun exactScore(m: Match, needle: String): Int {
        val n = needle.lowercase()
        return when {
            m.name.lowercase() == n || m.asciiname.lowercase() == n -> 2
            m.name.lowercase().startsWith(n) || m.asciiname.lowercase().startsWith(n) -> 1
            else -> 0
        }
    }

    private fun queryByName(
        db: SQLiteDatabase,
        needle: String,
        limit: Int,
        source: String,
    ): List<Match> {
        // SQLite's LIKE is case-insensitive for ASCII by default; the
        // asciiname column is already diacritic-stripped at import time so
        // "Zürich" matches "zurich". COLLATE NOCASE on the equality keeps
        // the exact-match arm cheap (uses the index) while LIKE 'foo%' is
        // a prefix scan that also benefits from the index.
        val sql = """
            SELECT p.geonameid, p.name, p.asciiname, p.country_code, p.admin1, p.admin2,
                   p.feature_code, p.population, p.lat, p.lon,
                   c.name AS country_name,
                   a.name AS admin1_name
            FROM places p
            LEFT JOIN countries c ON c.iso = p.country_code
            LEFT JOIN admin1    a ON a.country_code = p.country_code AND a.code = p.admin1
            WHERE p.name      LIKE ? COLLATE NOCASE
               OR p.asciiname LIKE ? COLLATE NOCASE
            ORDER BY p.population DESC
            LIMIT ?
        """.trimIndent()
        val pattern = "$needle%"
        val out = ArrayList<Match>()
        db.rawQuery(sql, arrayOf(pattern, pattern, limit.toString())).use { cur ->
            val iId = cur.getColumnIndexOrThrow("geonameid")
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
                out.add(
                    Match(
                        geonameid = cur.getLong(iId),
                        name = cur.getString(iName).orEmpty(),
                        asciiname = cur.getString(iAscii).orEmpty(),
                        admin1 = cur.getString(iAdmin1),
                        admin1Name = cur.getString(iA1Name),
                        admin2 = cur.getString(iAdmin2),
                        countryCode = cur.getString(iCc).orEmpty(),
                        countryName = cur.getString(iCountry),
                        featureCode = cur.getString(iFc),
                        population = if (cur.isNull(iPop)) 0 else cur.getInt(iPop),
                        lat = cur.getDouble(iLat),
                        lon = cur.getDouble(iLon),
                        distanceMeters = 0.0,
                        source = source,
                    )
                )
            }
        }
        return out
    }

    private fun queryWithin(
        db: SQLiteDatabase,
        lat: Double,
        lon: Double,
        cells: List<String>,
        radiusMeters: Double,
        source: String,
    ): List<Match> {
        if (cells.isEmpty()) return emptyList()
        val placeholders = cells.joinToString(",") { "?" }
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
        val out = ArrayList<Match>()
        db.rawQuery(sql, cells.toTypedArray()).use { cur ->
            val iId = cur.getColumnIndexOrThrow("geonameid")
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
                if (d > radiusMeters) continue
                out.add(
                    Match(
                        geonameid = cur.getLong(iId),
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
                )
            }
        }
        return out
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
        // The nearest-only path filters to feature class P (populated places)
        // — sticking parks/landmarks into the place-name label would render
        // as "Yosemite National Park, California" for someone standing in a
        // hotel at the park entrance, which is misleading.
        val sql = """
            SELECT p.geonameid, p.name, p.asciiname, p.country_code, p.admin1, p.admin2,
                   p.feature_code, p.population, p.lat, p.lon,
                   c.name AS country_name,
                   a.name AS admin1_name
            FROM places p
            LEFT JOIN countries c ON c.iso = p.country_code
            LEFT JOIN admin1    a ON a.country_code = p.country_code AND a.code = p.admin1
            WHERE p.geohash5 IN ($placeholders)
              AND substr(p.feature_code, 1, 3) = 'PPL'
        """.trimIndent()
        var best: Match? = null
        db.rawQuery(sql, cells.toTypedArray()).use { cur ->
            val iId = cur.getColumnIndexOrThrow("geonameid")
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
                        geonameid = cur.getLong(iId),
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
        val geonameid: Long,
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
