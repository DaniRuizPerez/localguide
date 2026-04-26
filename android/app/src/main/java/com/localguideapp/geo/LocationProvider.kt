package com.localguideapp.geo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Thin wrapper around FusedLocationProviderClient.
 *
 * Order:
 *   1. `getLastLocation()` if recent enough (≤ maxAgeMs).
 *   2. `getCurrentLocation()` (one-shot fix) at the requested priority.
 *
 * The bridge contract uses the strings "balanced" / "high" / "low"; we map
 * those to the matching `Priority.PRIORITY_*` constant.
 */
internal class LocationProvider(private val context: Context) {

    enum class PriorityHint(val gms: Int) {
        HIGH(Priority.PRIORITY_HIGH_ACCURACY),
        BALANCED(Priority.PRIORITY_BALANCED_POWER_ACCURACY),
        LOW(Priority.PRIORITY_LOW_POWER);

        companion object {
            fun parse(s: String?): PriorityHint = when (s?.lowercase()) {
                "high" -> HIGH
                "low" -> LOW
                else -> BALANCED
            }
        }
    }

    data class Fix(
        val lat: Double,
        val lon: Double,
        val accuracyMeters: Double,
        val ageMs: Long,
        val provider: String,
    )

    fun hasPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission") // Caller checks hasPermission(); we throw if not.
    suspend fun getCurrentLocation(priority: PriorityHint, maxAgeMs: Long): Fix {
        if (!hasPermission()) throw SecurityException("Missing FINE/COARSE location permission")

        val client: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)

        // Step 1: try last-known. If it's recent enough, return immediately —
        // typical case on a foregrounded app, costs no GPS warmup.
        val last = suspendCancellableCoroutine<android.location.Location?> { cont ->
            client.lastLocation
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        }
        if (last != null) {
            val age = System.currentTimeMillis() - last.time
            if (age <= maxAgeMs) {
                return Fix(
                    lat = last.latitude,
                    lon = last.longitude,
                    accuracyMeters = last.accuracy.toDouble(),
                    ageMs = age,
                    provider = last.provider ?: "lastKnown",
                )
            }
        }

        // Step 2: ask for a fresh fix. CurrentLocationRequest is the modern
        // (Play Services 21+) one-shot API — preferred over deprecated
        // requestSingleUpdate / requestLocationUpdates(numUpdates=1).
        val request = CurrentLocationRequest.Builder()
            .setPriority(priority.gms)
            .setMaxUpdateAgeMillis(maxAgeMs)
            .build()
        val cts = CancellationTokenSource()
        val location = suspendCancellableCoroutine<android.location.Location?> { cont ->
            cont.invokeOnCancellation { cts.cancel() }
            client.getCurrentLocation(request, cts.token)
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resumeWithException(it) }
        } ?: throw IllegalStateException("Location unavailable")

        val age = System.currentTimeMillis() - location.time
        return Fix(
            lat = location.latitude,
            lon = location.longitude,
            accuracyMeters = location.accuracy.toDouble(),
            ageMs = age,
            provider = location.provider ?: "fused",
        )
    }
}
