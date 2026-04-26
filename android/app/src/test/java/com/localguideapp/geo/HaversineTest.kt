package com.localguideapp.geo

import com.localguideapp.geo.ReverseGeocoder.Companion.haversineMeters
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HaversineTest {

    @Test
    fun samePointIsZero() {
        assertEquals(0.0, haversineMeters(40.4168, -3.7038, 40.4168, -3.7038), 0.001)
    }

    @Test
    fun symmetric() {
        val a = haversineMeters(40.4168, -3.7038, 41.3851, 2.1734) // Madrid -> Barcelona
        val b = haversineMeters(41.3851, 2.1734, 40.4168, -3.7038)
        assertEquals(a, b, 0.001)
    }

    @Test
    fun madridToBarcelonaIsAboutFiveHundredKm() {
        // Reference: ~505 km great-circle. Allow ±5 km for rounding.
        val d = haversineMeters(40.4168, -3.7038, 41.3851, 2.1734)
        assertEquals(505_000.0, d, 5_000.0)
    }

    @Test
    fun newYorkToLondonIsAboutFiveThousandFiveHundredKm() {
        // Reference: ~5,570 km great-circle. Allow ±20 km.
        val d = haversineMeters(40.7128, -74.0060, 51.5074, -0.1278)
        assertEquals(5_570_000.0, d, 20_000.0)
    }

    @Test
    fun antipodeIsHalfTheEarthsCircumference() {
        // Madrid (40.4168, -3.7038) → its antipode (-40.4168, 176.2962)
        // should be ~20,015 km. Accept ±50 km wiggle for the spherical-earth
        // approximation.
        val d = haversineMeters(40.4168, -3.7038, -40.4168, 176.2962)
        assertEquals(20_015_000.0, d, 50_000.0)
    }

    @Test
    fun nearbyPointsClampSafely() {
        // Two coords 1 m apart shouldn't produce NaN/Infinity from the
        // sqrt(1 - a) clamp branch in the implementation.
        val d = haversineMeters(40.4168, -3.7038, 40.41681, -3.7038)
        assertTrue("distance must be finite, got $d", d.isFinite())
        assertTrue("distance must be tiny, got $d", d < 5.0)
    }
}
