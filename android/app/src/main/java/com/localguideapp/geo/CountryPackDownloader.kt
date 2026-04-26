package com.localguideapp.geo

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * Downloads a `{ISO}.db.gz` from a caller-supplied URL and gunzips it into
 * `filesDir/geo/{ISO}.db`. After extraction we open the new DB read-only,
 * verify `meta.snapshot_date` matches the expected value, then write the
 * `{ISO}.snapshot` sentinel.
 *
 * Progress is reported through [Progress] callbacks. Phases:
 *   - "download": bytesDownloaded / bytesTotal (-1 if Content-Length absent)
 *   - "extract":  no byte counters; gunzip is fast enough not to stream them
 *   - "open":     emitted once before opening the DB to validate
 *
 * The downloader runs synchronously on the caller's coroutine — typical use is
 * launching it on `Dispatchers.IO`.
 */
internal class CountryPackDownloader(private val geoDb: GeoDatabase) {

    fun interface Progress {
        fun onProgress(phase: String, bytesDownloaded: Long, bytesTotal: Long)
    }

    /** @throws IOException on network or filesystem failure. @throws IllegalStateException on metadata mismatch. */
    fun install(
        iso: String,
        downloadUrl: String,
        expectedSnapshotDate: String,
        progress: Progress,
    ) {
        val key = iso.uppercase()
        val dir = geoDb.geoDir()
        val gzTmp = File(dir, "$key.db.gz.tmp")
        val dbTmp = File(dir, "$key.db.tmp")
        val finalDb = geoDb.countryPackFile(key)
        val sentinel = geoDb.countryPackSnapshotFile(key)

        try {
            // --- DOWNLOAD ---
            val conn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 60_000
                requestMethod = "GET"
                instanceFollowRedirects = true
            }
            try {
                val code = conn.responseCode
                if (code !in 200..299) {
                    throw IOException("HTTP $code while downloading $downloadUrl")
                }
                val total = conn.contentLengthLong
                progress.onProgress("download", 0L, total)
                conn.inputStream.use { input ->
                    FileOutputStream(gzTmp).use { out ->
                        val buf = ByteArray(64 * 1024)
                        var written = 0L
                        var lastEmit = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n <= 0) break
                            out.write(buf, 0, n)
                            written += n
                            // Throttle progress emissions to ~10 Hz so we don't
                            // flood the JS bridge on a fast connection.
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= 100L) {
                                progress.onProgress("download", written, total)
                                lastEmit = now
                            }
                        }
                        progress.onProgress("download", written, total)
                    }
                }
            } finally {
                conn.disconnect()
            }

            // --- EXTRACT ---
            progress.onProgress("extract", 0L, -1L)
            gzTmp.inputStream().use { raw ->
                GZIPInputStream(raw).use { gz ->
                    FileOutputStream(dbTmp).use { out ->
                        gz.copyTo(out, bufferSize = 64 * 1024)
                    }
                }
            }
            gzTmp.delete()

            // --- OPEN + VALIDATE ---
            progress.onProgress("open", 0L, -1L)
            val snapshotDate = geoDb.readSnapshotDate(dbTmp)
                ?: throw IllegalStateException("Pack DB missing meta.snapshot_date")
            if (snapshotDate != expectedSnapshotDate) {
                throw IllegalStateException(
                    "Snapshot mismatch: expected $expectedSnapshotDate, got $snapshotDate"
                )
            }
            // Cross-check `meta.source` reports the same ISO we were told to install.
            // Format from build_geo_db.py: "country:{ISO}".
            geoDb.readSource(dbTmp)?.let { src ->
                val expected = "country:$key"
                if (!src.equals(expected, ignoreCase = true)) {
                    Log.w(
                        TAG,
                        "Pack source $src does not match expected $expected (continuing anyway)"
                    )
                }
            }

            // --- COMMIT ---
            if (finalDb.exists()) finalDb.delete()
            if (!dbTmp.renameTo(finalDb)) {
                throw IOException("Failed to rename ${dbTmp.name} → ${finalDb.name}")
            }
            sentinel.writeText(snapshotDate)
        } catch (t: Throwable) {
            // Clean up partial files so a retry starts from scratch.
            if (gzTmp.exists()) gzTmp.delete()
            if (dbTmp.exists()) dbTmp.delete()
            throw t
        }
    }

    companion object {
        private const val TAG = "GeoPackDL"
    }
}
