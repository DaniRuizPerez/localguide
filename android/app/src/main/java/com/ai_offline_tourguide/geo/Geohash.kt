package com.ai_offline_tourguide.geo

/**
 * Minimal geohash encoder + neighbor expansion for the offline reverse-geocoder.
 *
 * Standard geohash base32 alphabet `0123456789bcdefghjkmnpqrstuvwxyz` (no a/i/l/o).
 * Bits are interleaved lon/lat: even-indexed bits encode longitude, odd-indexed
 * bits encode latitude. Length 5 ≈ 4.9 km × 4.9 km cells at the equator, which
 * matches the granularity used by `build_geo_db.py` when populating
 * `places.geohash5`.
 *
 * We only ever need length-5 hashes here; the helpers are not generalised.
 */
internal object Geohash {

    private const val BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
    private val DECODE_MAP: IntArray = IntArray(128) { -1 }.also { tbl ->
        for (i in BASE32.indices) tbl[BASE32[i].code] = i
    }

    /** Encode (lat, lon) at the given precision (chars). */
    fun encode(lat: Double, lon: Double, precision: Int = 5): String {
        var minLat = -90.0
        var maxLat = 90.0
        var minLon = -180.0
        var maxLon = 180.0
        val sb = StringBuilder(precision)
        var bit = 0
        var ch = 0
        var even = true // start with longitude
        while (sb.length < precision) {
            if (even) {
                val mid = (minLon + maxLon) / 2.0
                if (lon >= mid) { ch = (ch shl 1) or 1; minLon = mid } else { ch = ch shl 1; maxLon = mid }
            } else {
                val mid = (minLat + maxLat) / 2.0
                if (lat >= mid) { ch = (ch shl 1) or 1; minLat = mid } else { ch = ch shl 1; maxLat = mid }
            }
            even = !even
            bit++
            if (bit == 5) {
                sb.append(BASE32[ch])
                bit = 0
                ch = 0
            }
        }
        return sb.toString()
    }

    /** Decode a geohash to its bounding box: (minLat, minLon, maxLat, maxLon). */
    private fun decodeBounds(hash: String): DoubleArray {
        var minLat = -90.0; var maxLat = 90.0
        var minLon = -180.0; var maxLon = 180.0
        var even = true
        for (c in hash) {
            val cd = DECODE_MAP[c.code]
            require(cd >= 0) { "Invalid geohash char: $c" }
            for (i in 4 downTo 0) {
                val bit = (cd ushr i) and 1
                if (even) {
                    val mid = (minLon + maxLon) / 2.0
                    if (bit == 1) minLon = mid else maxLon = mid
                } else {
                    val mid = (minLat + maxLat) / 2.0
                    if (bit == 1) minLat = mid else maxLat = mid
                }
                even = !even
            }
        }
        return doubleArrayOf(minLat, minLon, maxLat, maxLon)
    }

    /** Returns the 8 neighbors (N, NE, E, SE, S, SW, W, NW) of `hash`. */
    fun neighbors(hash: String): List<String> {
        val bounds = decodeBounds(hash)
        val minLat = bounds[0]; val minLon = bounds[1]
        val maxLat = bounds[2]; val maxLon = bounds[3]
        val latStep = maxLat - minLat
        val lonStep = maxLon - minLon
        val centerLat = (minLat + maxLat) / 2.0
        val centerLon = (minLon + maxLon) / 2.0
        // Sample slightly inside neighbor cells to avoid edge ambiguity.
        val precision = hash.length
        val out = ArrayList<String>(8)
        for (dLat in intArrayOf(1, 0, -1)) {
            for (dLon in intArrayOf(-1, 0, 1)) {
                if (dLat == 0 && dLon == 0) continue
                val lat = (centerLat + dLat * latStep).coerceIn(-90.0, 90.0)
                var lon = centerLon + dLon * lonStep
                // Wrap longitude into [-180, 180].
                while (lon > 180.0) lon -= 360.0
                while (lon < -180.0) lon += 360.0
                out.add(encode(lat, lon, precision))
            }
        }
        return out
    }

    /**
     * Returns a deduped block of cells centered on `hash` with `radius` rings.
     * radius=1 → 3x3 block (9 cells), radius=2 → 5x5 block (~25 cells).
     */
    fun neighborBlock(hash: String, radius: Int = 2): List<String> {
        if (radius <= 0) return listOf(hash)
        val seen = LinkedHashSet<String>()
        seen.add(hash)
        var frontier: Set<String> = setOf(hash)
        repeat(radius) {
            val next = LinkedHashSet<String>()
            for (h in frontier) {
                for (n in neighbors(h)) {
                    if (seen.add(n)) next.add(n)
                }
            }
            frontier = next
        }
        return seen.toList()
    }
}
