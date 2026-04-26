# GeoNames offline reverse-geocoding packs

This directory builds gzipped SQLite databases from the public
[GeoNames](https://download.geonames.org/export/dump/) dumps so the app can do
reverse geocoding fully offline. The Python builder (`build_geo_db.py`) uses
the standard library only — no `pip install` step is required.

## Build locally

The script has two subcommands: `cities15000` (one global pack of cities with
population >= 15k) and `country` (one pack per ISO country code). Download the
matching ZIP from GeoNames first, then point the builder at it:

```sh
# Global cities15000 pack (~400 MB download)
curl -LO https://download.geonames.org/export/dump/allCountries.zip
python build_geo_db.py cities15000 --zip allCountries.zip --out cities15000.db.gz

# Single-country pack (much smaller)
curl -LO https://download.geonames.org/export/dump/US.zip
python build_geo_db.py country --zip US.zip --iso US --out US.db.gz
```

A `.cache/` folder is created next to the script for `countryInfo.txt` and
`admin1CodesASCII.txt`; safe to delete, will be re-fetched as needed.

## Trigger the workflow

CI rebuilds every pack on the 1st of each month and uploads them to a GitHub
Release tagged `geo-YYYYMMDD`. To kick off a manual run:

```sh
# All countries in COUNTRIES.txt
gh workflow run build-geo-packs.yml

# Just one country (faster iteration)
gh workflow run build-geo-packs.yml -f iso_filter=US
```

The country list lives in `COUNTRIES.txt` — one ISO code per line, sorted.
Add a code there to include it in the next build.
