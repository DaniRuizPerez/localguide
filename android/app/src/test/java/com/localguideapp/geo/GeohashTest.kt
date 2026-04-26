package com.localguideapp.geo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeohashTest {

    @Test
    fun encodeReturnsKnownReferenceHashes() {
        // Reference values produced by `geohash.org` for these coords at length 5.
        // Madrid (Puerta del Sol).
        assertEquals("ezjmg", Geohash.encode(40.4168, -3.7038, 5))
        // Paris (Eiffel Tower).
        assertEquals("u09tu", Geohash.encode(48.8584, 2.2945, 5))
        // Manhattan (Times Square).
        assertEquals("dr5ru", Geohash.encode(40.7589, -73.9851, 5))
    }

    @Test
    fun encodeIsDeterministic() {
        // Same input → same hash. Cheap regression for accidental state in the
        // encoder (it builds locally and shouldn't carry state between calls).
        val a = Geohash.encode(35.6762, 139.6503, 5)
        val b = Geohash.encode(35.6762, 139.6503, 5)
        assertEquals(a, b)
    }

    @Test
    fun encodeRespectsPrecision() {
        val short = Geohash.encode(40.4168, -3.7038, 3)
        val long = Geohash.encode(40.4168, -3.7038, 7)
        assertEquals(3, short.length)
        assertEquals(7, long.length)
        // Longer hash is a refinement of the shorter one (geohash prefix property).
        assertTrue(long.startsWith(short))
    }

    @Test
    fun neighborsReturnsEightDistinctCells() {
        val center = "ezjmg"
        val neighbors = Geohash.neighbors(center)
        assertEquals(8, neighbors.size)
        // None of the neighbors equals the center cell.
        assertTrue(neighbors.none { it == center })
        // All of them are length-5 hashes.
        assertTrue(neighbors.all { it.length == 5 })
        // All distinct from each other.
        assertEquals(8, neighbors.toSet().size)
    }

    @Test
    fun neighborBlockSizesAreCorrect() {
        val center = "ezjmg"
        // radius 0 = self only
        assertEquals(listOf(center), Geohash.neighborBlock(center, radius = 0))
        // radius 1 = 3x3 = 9 cells
        assertEquals(9, Geohash.neighborBlock(center, radius = 1).size)
        // radius 2 = 5x5 = 25 cells
        assertEquals(25, Geohash.neighborBlock(center, radius = 2).size)
        // The center is always part of the block.
        assertTrue(Geohash.neighborBlock(center, radius = 2).contains(center))
    }

    @Test
    fun nearbyCoordsLandInOverlappingBlocks() {
        // Two points ~5 km apart should share at least one cell in their
        // 5x5 neighbor blocks — the kNN query relies on this.
        val a = Geohash.encode(40.4165, -3.70256, 5) // Madrid Sol
        val b = Geohash.encode(40.41831, -3.70275, 5) // Madrid Centro (~200 m north)
        val blockA = Geohash.neighborBlock(a, radius = 2).toSet()
        val blockB = Geohash.neighborBlock(b, radius = 2).toSet()
        assertTrue(
            "Nearby points must share neighbor cells; blockA=$blockA, b=$b",
            blockA.contains(b) || blockA.intersect(blockB).isNotEmpty()
        )
    }

    @Test
    fun differentRegionsProduceDifferentHashes() {
        val madrid = Geohash.encode(40.4168, -3.7038, 5)
        val tokyo = Geohash.encode(35.6762, 139.6503, 5)
        val sydney = Geohash.encode(-33.8688, 151.2093, 5)
        assertNotEquals(madrid, tokyo)
        assertNotEquals(madrid, sydney)
        assertNotEquals(tokyo, sydney)
    }
}
