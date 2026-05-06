package com.ai_offline_tourguide.geo

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Owns the bundled cities15000 DB and any installed country-pack DBs.
 *
 * Layout under `filesDir/geo/`:
 *   cities15000.db              extracted, read-only
 *   cities15000.assethash       hex sha-256 of the gzipped asset that produced .db
 *   {ISO}.db                    installed country pack
 *   {ISO}.snapshot              the snapshot_date the pack was installed at
 *
 * One [SQLiteDatabase] is cached per file. Access is serialized by [mutex] so
 * we don't open the same DB twice racing — SQLite itself is thread-safe for
 * read-only queries once open, but we want a single connection per file.
 */
internal class GeoDatabase(private val context: Context) {

    private val mutex = Mutex()
    private var cities: SQLiteDatabase? = null
    private val packs = HashMap<String, SQLiteDatabase>()

    /** Returns the open cities15000 DB, extracting from assets on first use / version change. */
    suspend fun openCities(): SQLiteDatabase = mutex.withLock {
        cities?.let { if (it.isOpen) return it }
        ensureCitiesExtracted()
        val path = File(geoDir(), CITIES_DB).absolutePath
        val db = SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY)
        cities = db
        db
    }

    /** Returns the open DB for an installed country pack, or null if not installed. */
    suspend fun openCountryPack(iso: String): SQLiteDatabase? = mutex.withLock {
        val key = iso.uppercase()
        packs[key]?.let { if (it.isOpen) return it }
        val file = countryPackFile(key)
        if (!file.exists()) return null
        val db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        packs[key] = db
        db
    }

    /** List installed country packs by enumerating `{ISO}.db` files under filesDir/geo/. */
    fun listInstalledPacks(): List<InstalledPack> {
        val dir = geoDir()
        if (!dir.exists()) return emptyList()
        return dir.listFiles { f ->
            f.isFile && f.name.endsWith(".db") && f.name != CITIES_DB
        }?.mapNotNull { f ->
            val iso = f.name.removeSuffix(".db").uppercase()
            // Two-letter ISO only — defensive filter against stray files.
            if (iso.length != 2) return@mapNotNull null
            val snap = File(dir, "$iso.snapshot").takeIf { it.exists() }?.readText()?.trim().orEmpty()
            InstalledPack(iso = iso, snapshotDate = snap, sizeBytes = f.length())
        }?.sortedBy { it.iso } ?: emptyList()
    }

    /** Deletes pack files for the given ISO. Closes the cached connection if any. */
    suspend fun uninstallPack(iso: String): Boolean = mutex.withLock {
        val key = iso.uppercase()
        packs.remove(key)?.let { try { it.close() } catch (_: Throwable) {} }
        var deleted = false
        val db = countryPackFile(key)
        if (db.exists()) deleted = db.delete() || deleted
        val snap = File(geoDir(), "$key.snapshot")
        if (snap.exists()) snap.delete()
        deleted
    }

    /** Resolves the on-disk path that [installCountryPack]/uninstall use. */
    fun countryPackFile(iso: String): File = File(geoDir(), "${iso.uppercase()}.db")
    fun countryPackSnapshotFile(iso: String): File = File(geoDir(), "${iso.uppercase()}.snapshot")

    fun geoDir(): File = File(context.filesDir, "geo").apply { if (!exists()) mkdirs() }

    /**
     * Make sure `filesDir/geo/cities15000.db` exists and matches the current asset.
     *
     * Detection strategy: stream-hash the asset bytes (SHA-256, 64 KB chunks)
     * and compare with the `cities15000.assethash` sentinel. If they match,
     * reuse the extracted DB. If they differ — or no extracted DB exists —
     * re-extract.
     *
     * The asset ships as a raw SQLite file (not gzipped). AGP's mergeAssets
     * task auto-decompresses any `.gz` we hand it, leaving the raw bytes
     * inside the APK regardless — so wrapping was pointless and broke the
     * extraction path. The APK ZIP still deflate-compresses the asset on its
     * own, so on-device install size is unaffected.
     */
    private fun ensureCitiesExtracted() {
        val dir = geoDir()
        val db = File(dir, CITIES_DB)
        val sentinel = File(dir, CITIES_HASH)
        val assetHash = computeAssetSha256(CITIES_ASSET)
        if (db.exists() && sentinel.exists() && sentinel.readText().trim() == assetHash) {
            return
        }
        Log.i(TAG, "Extracting bundled $CITIES_ASSET → ${db.absolutePath} (hash=$assetHash)")
        val tmp = File(dir, "$CITIES_DB.tmp")
        try {
            context.assets.open(CITIES_ASSET).use { input ->
                FileOutputStream(tmp).use { out ->
                    input.copyTo(out, bufferSize = 64 * 1024)
                }
            }
            if (db.exists()) db.delete()
            if (!tmp.renameTo(db)) {
                throw java.io.IOException("Failed to rename ${tmp.name} → ${db.name}")
            }
            sentinel.writeText(assetHash)
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }

    private fun computeAssetSha256(assetPath: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        context.assets.open(assetPath).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Reads `meta.snapshot_date` from a freshly-written DB file (used during install). */
    fun readSnapshotDate(dbFile: File): String? {
        val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        return try {
            db.rawQuery("SELECT value FROM meta WHERE key = ?", arrayOf("snapshot_date")).use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } finally {
            try { db.close() } catch (_: Throwable) {}
        }
    }

    /** Reads `meta.source` (e.g. "country:US"). Useful for cross-checking the ISO. */
    fun readSource(dbFile: File): String? {
        val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        return try {
            db.rawQuery("SELECT value FROM meta WHERE key = ?", arrayOf("source")).use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } finally {
            try { db.close() } catch (_: Throwable) {}
        }
    }

    suspend fun closeAll() = mutex.withLock {
        try { cities?.close() } catch (_: Throwable) {}
        cities = null
        packs.values.forEach { try { it.close() } catch (_: Throwable) {} }
        packs.clear()
    }

    data class InstalledPack(val iso: String, val snapshotDate: String, val sizeBytes: Long)

    companion object {
        private const val TAG = "GeoDatabase"
        const val CITIES_ASSET = "geo/cities15000.db"
        const val CITIES_DB = "cities15000.db"
        const val CITIES_HASH = "cities15000.assethash"
    }
}
