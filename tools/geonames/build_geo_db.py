"""
GeoNames -> SQLite builder for offline reverse geocoding.

Two modes:

  python build_geo_db.py cities15000 \
      --zip C:\\Users\\danir\\geonames\\allCountries.zip \
      --out ..\\..\\android\\app\\src\\main\\assets\\geo\\cities15000.db.gz \
      --min-population 15000

  python build_geo_db.py country \
      --zip path\\to\\US.zip \
      --iso US \
      --out releases\\US.db.gz

Schema (identical for cities15000 and country packs):

  meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)
    schema_version=1, snapshot_date=YYYY-MM-DD, source='cities15000'|'country:{ISO}'
  places(geonameid INTEGER PRIMARY KEY, name TEXT, asciiname TEXT,
         country_code TEXT, admin1 TEXT, admin2 TEXT, feature_code TEXT,
         population INTEGER, lat REAL, lon REAL, geohash5 TEXT)
  countries(iso TEXT PRIMARY KEY, iso3 TEXT, name TEXT)
  admin1(country_code TEXT, code TEXT, name TEXT, asciiname TEXT,
         PRIMARY KEY(country_code, code))

Indexes: idx_places_geohash5, idx_places_country.

Geohash length 5 (~5 km cells). Lookup queries the 5x5 block around the
query cell (~25 km radius worst case) and Haversine-ranks candidates.

Skipped feature codes: PPLH (historical), PPLW (destroyed), PPLQ (abandoned).
"""

from __future__ import annotations

import argparse
import gzip
import io
import os
import shutil
import sqlite3
import sys
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

GEONAMES_URLS = {
    "countryInfo": "https://download.geonames.org/export/dump/countryInfo.txt",
    "admin1": "https://download.geonames.org/export/dump/admin1CodesASCII.txt",
}
SKIP_FEATURE_CODES = {"PPLH", "PPLW", "PPLQ", "PPLCH"}
GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"
SCHEMA_VERSION = "1"

# Country packs include populated places + a curated set of landmarks. These
# are the feature codes that consistently map to "place a tourist would
# narrate about" — parks/preserves under feature class L, plus a tight
# allowlist of S (spot/building) codes that excludes farms, ATMs, schools,
# and other GeoNames noise. The runtime POI lookup queries everything in
# this list within `radiusMeters` of the user.
COUNTRY_PACK_FEATURE_CLASSES = {"P"}  # populated places
COUNTRY_PACK_L_CODES = {
    "PRK",   # park
    "NATP",  # national park
    "RES",   # reserve
    "RESN",  # nature reserve
    "RESF",  # forest reserve
    "RESV",  # reservation
    "RESP",  # palm tree reserve  (rare; cheap to include)
    "AMUS",  # amusement park
    "GDN",   # garden(s)
    "ZN",    # zone (e.g. historic district) — keep, lots of false positives
}
COUNTRY_PACK_S_CODES = {
    "MNMT",  # monument
    "HSTS",  # historical site
    "MUS",   # museum
    "CSTL",  # castle
    "PAL",   # palace
    "TMPL",  # temple
    "CH",    # church
    "MSQE",  # mosque
    "SHRN",  # shrine
    "SYG",   # synagogue
    "MSTY",  # monastery
    "ABBY",  # abbey
    "CTHSE", # courthouse
    "GOVL",  # local government office
    "CTRR",  # religious center
    "CTRCM", # community center
    "LIBR",  # library
    "OPRA",  # opera house
    "THTR",  # theater
    "AMTH",  # amphitheater
    "STDM",  # stadium
    "ARCH",  # arch
    "OBS",   # observatory
    "OBPT",  # observation point / lookout
    "TOWR",  # tower
    "LTHSE", # lighthouse
    "ZOO",
    "SQR",   # square / plaza
    "PIER",
    "MAR",   # marina
    "CTRA",  # athletic center
    "UNIV",  # university
    "COLL",  # college
    "SCHA",  # academy / specialised school
    "PRSH",  # parish house
    "FT",    # fort
    "RUIN",  # ruin
    "ANS",   # ancient site
}


def geohash_encode(lat: float, lon: float, length: int = 5) -> str:
    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0
    bits: list[int] = []
    even = True
    while len(bits) < length * 5:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon >= mid:
                bits.append(1)
                lon_lo = mid
            else:
                bits.append(0)
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                bits.append(1)
                lat_lo = mid
            else:
                bits.append(0)
                lat_hi = mid
        even = not even
    out = []
    for i in range(0, len(bits), 5):
        idx = (bits[i] << 4) | (bits[i + 1] << 3) | (bits[i + 2] << 2) | (bits[i + 3] << 1) | bits[i + 4]
        out.append(GEOHASH_ALPHABET[idx])
    return "".join(out)


def fetch_aux(cache_dir: Path) -> tuple[Path, Path]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    country_path = cache_dir / "countryInfo.txt"
    admin1_path = cache_dir / "admin1CodesASCII.txt"
    if not country_path.exists():
        print(f"Fetching {GEONAMES_URLS['countryInfo']}", file=sys.stderr)
        urllib.request.urlretrieve(GEONAMES_URLS["countryInfo"], country_path)
    if not admin1_path.exists():
        print(f"Fetching {GEONAMES_URLS['admin1']}", file=sys.stderr)
        urllib.request.urlretrieve(GEONAMES_URLS["admin1"], admin1_path)
    return country_path, admin1_path


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        PRAGMA page_size = 4096;

        CREATE TABLE meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE places (
            geonameid    INTEGER PRIMARY KEY,
            name         TEXT NOT NULL,
            asciiname    TEXT NOT NULL,
            country_code TEXT NOT NULL,
            admin1       TEXT,
            admin2       TEXT,
            feature_code TEXT,
            population   INTEGER NOT NULL DEFAULT 0,
            lat          REAL NOT NULL,
            lon          REAL NOT NULL,
            geohash5     TEXT NOT NULL
        );

        CREATE TABLE countries (
            iso  TEXT PRIMARY KEY,
            iso3 TEXT,
            name TEXT NOT NULL
        );

        CREATE TABLE admin1 (
            country_code TEXT NOT NULL,
            code         TEXT NOT NULL,
            name         TEXT NOT NULL,
            asciiname    TEXT,
            PRIMARY KEY (country_code, code)
        );
        """
    )


def load_countries(conn: sqlite3.Connection, country_info: Path) -> int:
    rows = []
    with country_info.open(encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 5:
                continue
            iso, iso3, name = parts[0], parts[1], parts[4]
            if not iso or not name:
                continue
            rows.append((iso, iso3, name))
    conn.executemany("INSERT OR REPLACE INTO countries VALUES (?,?,?)", rows)
    return len(rows)


def load_admin1(conn: sqlite3.Connection, admin1_path: Path) -> int:
    rows = []
    with admin1_path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4:
                continue
            cc_code, name, asciiname = parts[0], parts[1], parts[2]
            if "." not in cc_code:
                continue
            cc, code = cc_code.split(".", 1)
            rows.append((cc, code, name, asciiname))
    conn.executemany("INSERT OR REPLACE INTO admin1 VALUES (?,?,?,?)", rows)
    return len(rows)


def iter_geonames_rows(zip_path: Path, member: str | None = None):
    """Stream rows from a GeoNames TSV inside a zip. Detects the only .txt member if not given."""
    with zipfile.ZipFile(zip_path) as z:
        if member is None:
            txt_members = [n for n in z.namelist() if n.endswith(".txt") and "readme" not in n.lower()]
            if not txt_members:
                raise SystemExit(f"No .txt found in {zip_path}")
            member = txt_members[0]
        with z.open(member) as f:
            reader = io.TextIOWrapper(f, encoding="utf-8", newline="")
            for raw in reader:
                if not raw or raw.startswith("#"):
                    continue
                parts = raw.rstrip("\n").split("\t")
                if len(parts) < 19:
                    continue
                yield parts


def load_places(
    conn: sqlite3.Connection,
    zip_path: Path,
    min_population: int,
    iso_filter: str | None = None,
    include_landmarks: bool = False,
) -> int:
    """Stream the GeoNames TSV into the `places` table.

    `include_landmarks=False` reproduces the cities15000 behavior: keep only
    feature class P (populated places) above `min_population`, minus the
    historical/destroyed codes.

    `include_landmarks=True` (used for country packs) additionally keeps
    feature class L parks/preserves and a curated allowlist of S codes
    (museums, monuments, castles, etc.) regardless of population. The
    population filter still applies to the P-class rows so sub-1k hamlets
    don't drown out the chip list.
    """
    BATCH = 5000
    batch: list[tuple] = []
    inserted = 0
    seen = 0
    for parts in iter_geonames_rows(zip_path):
        seen += 1
        if seen % 250000 == 0:
            print(f"  scanned {seen:,} rows, inserted {inserted:,}", file=sys.stderr)

        feature_class = parts[6]
        feature_code = parts[7]

        # Class-aware filter. P rows always honor min_population and the
        # historical/destroyed skip list. L and S rows only land when the
        # caller asked for landmarks AND the code is in our allowlist.
        if feature_class == "P":
            if feature_code in SKIP_FEATURE_CODES:
                continue
            try:
                pop = int(parts[14]) if parts[14] else 0
            except ValueError:
                pop = 0
            if pop < min_population:
                continue
        elif include_landmarks and feature_class == "L":
            if feature_code not in COUNTRY_PACK_L_CODES:
                continue
            try:
                pop = int(parts[14]) if parts[14] else 0
            except ValueError:
                pop = 0
        elif include_landmarks and feature_class == "S":
            if feature_code not in COUNTRY_PACK_S_CODES:
                continue
            try:
                pop = int(parts[14]) if parts[14] else 0
            except ValueError:
                pop = 0
        else:
            continue

        country_code = parts[8]
        if iso_filter and country_code != iso_filter:
            continue
        try:
            geonameid = int(parts[0])
            lat = float(parts[4])
            lon = float(parts[5])
        except ValueError:
            continue
        gh = geohash_encode(lat, lon, 5)
        batch.append(
            (
                geonameid,
                parts[1],
                parts[2],
                country_code,
                parts[10] or None,
                parts[11] or None,
                parts[7] or None,
                pop,
                lat,
                lon,
                gh,
            )
        )
        if len(batch) >= BATCH:
            conn.executemany(
                "INSERT OR REPLACE INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                batch,
            )
            inserted += len(batch)
            batch.clear()
    if batch:
        conn.executemany(
            "INSERT OR REPLACE INTO places VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            batch,
        )
        inserted += len(batch)
    print(f"  scanned {seen:,} rows total, inserted {inserted:,} places", file=sys.stderr)
    return inserted


def write_meta(conn: sqlite3.Connection, source: str) -> None:
    conn.executemany(
        "INSERT OR REPLACE INTO meta VALUES (?,?)",
        [
            ("schema_version", SCHEMA_VERSION),
            ("snapshot_date", date.today().isoformat()),
            ("source", source),
        ],
    )


def finalize(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE INDEX idx_places_geohash5 ON places(geohash5)")
    conn.execute("CREATE INDEX idx_places_country ON places(country_code)")
    conn.commit()
    conn.execute("VACUUM")
    conn.commit()


def gzip_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with src.open("rb") as fin, gzip.open(dst, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout, length=1024 * 1024)


def build(mode: str, zip_path: Path, out_path: Path, min_population: int, iso: str | None) -> None:
    if not zip_path.exists():
        raise SystemExit(f"Zip not found: {zip_path}")

    cache_dir = Path(__file__).parent / ".cache"
    country_info, admin1_path = fetch_aux(cache_dir)

    tmp_db = out_path.with_suffix(".tmp.db")
    if tmp_db.exists():
        tmp_db.unlink()
    tmp_db.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(tmp_db)
    try:
        init_schema(conn)
        n_countries = load_countries(conn, country_info)
        n_admin1 = load_admin1(conn, admin1_path)
        print(f"Loaded {n_countries} countries, {n_admin1} admin1 entries", file=sys.stderr)

        n_places = load_places(
            conn,
            zip_path,
            min_population,
            iso_filter=iso if mode == "country" else None,
            include_landmarks=(mode == "country"),
        )

        # Country packs need a feature_code index too — the offline POI
        # lookup filters by parks/landmarks codes when ranking nearby spots.
        if mode == "country":
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_places_feature_code "
                "ON places(feature_code)"
            )
            conn.commit()

        source = "cities15000" if mode == "cities15000" else f"country:{iso}"
        write_meta(conn, source)
        finalize(conn)
        print(f"Built {n_places} places ({source})", file=sys.stderr)
    finally:
        conn.close()

    if out_path.suffix == ".gz":
        gzip_file(tmp_db, out_path)
        tmp_db.unlink()
    else:
        if out_path.exists():
            out_path.unlink()
        tmp_db.rename(out_path)

    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024 / 1024:.1f} MB)", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="mode", required=True)

    a = sub.add_parser("cities15000", help="Build the global cities>=15k bundled DB")
    a.add_argument("--zip", required=True, type=Path, help="Path to allCountries.zip")
    a.add_argument("--out", required=True, type=Path, help="Output .db.gz path")
    a.add_argument("--min-population", type=int, default=15000)

    b = sub.add_parser("country", help="Build a per-country DB pack")
    b.add_argument("--zip", required=True, type=Path, help="Path to {ISO}.zip from GeoNames")
    b.add_argument("--iso", required=True, help="ISO 3166-1 alpha-2 country code (e.g. US, ES)")
    b.add_argument("--out", required=True, type=Path)
    b.add_argument("--min-population", type=int, default=0)

    args = p.parse_args()

    if args.mode == "cities15000":
        build("cities15000", args.zip, args.out, args.min_population, iso=None)
    elif args.mode == "country":
        iso = args.iso.upper()
        if len(iso) != 2 or not iso.isalpha():
            raise SystemExit(f"--iso must be a 2-letter code, got {iso!r}")
        build("country", args.zip, args.out, args.min_population, iso=iso)


if __name__ == "__main__":
    main()
