import {
  reverseGeocode,
  listAvailableCountryPacks,
  countryNameForIso,
  __resetForTest,
} from '../services/OfflineGeocoder';
import { isGeoModuleAvailable } from '../native/GeoModule';

jest.mock('../native/GeoModule', () => {
  const reverseGeocode = jest.fn();
  return {
    __esModule: true,
    default: { reverseGeocode },
    isGeoModuleAvailable: jest.fn(() => true),
    GEO_EVENT_PROGRESS: 'GeoPackProgress',
    GEO_EVENT_ERROR: 'GeoPackError',
    GEO_EVENT_COMPLETE: 'GeoPackComplete',
  };
});

const mockedReverse = jest.requireMock('../native/GeoModule').default
  .reverseGeocode as jest.Mock;
const mockedAvailable = jest.requireMock('../native/GeoModule')
  .isGeoModuleAvailable as jest.Mock;

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function place(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    geonameid: 3117735,
    name: 'Madrid',
    asciiname: 'Madrid',
    admin1: '29',
    admin1Name: 'Madrid',
    admin2: 'M',
    countryCode: 'ES',
    countryName: 'Spain',
    featureCode: 'PPLC',
    population: 3255944,
    lat: 40.4165,
    lon: -3.70256,
    distanceMeters: 110,
    source: 'cities15000',
    ...overrides,
  };
}

beforeEach(() => {
  __resetForTest();
  mockedReverse.mockReset();
  mockedAvailable.mockReturnValue(true);
  fetchMock.mockReset();
});

describe('OfflineGeocoder.reverseGeocode', () => {
  it('returns null without calling native when module is unavailable', async () => {
    mockedAvailable.mockReturnValue(false);
    const result = await reverseGeocode(40.4168, -3.7038);
    expect(result).toBeNull();
    expect(mockedReverse).not.toHaveBeenCalled();
  });

  it('returns null when the native call resolves to null', async () => {
    mockedReverse.mockResolvedValue(null);
    expect(await reverseGeocode(0, 0)).toBeNull();
  });

  it('returns null when the native call rejects', async () => {
    mockedReverse.mockRejectedValue(new Error('boom'));
    expect(await reverseGeocode(0, 0)).toBeNull();
  });

  it('formats "City, Region, Country" when all parts are distinct', async () => {
    mockedReverse.mockResolvedValue(
      place({ name: 'Cambre', admin1Name: 'Galicia', countryName: 'Spain' })
    );
    expect(await reverseGeocode(43.29, -8.34)).toBe('Cambre, Galicia, Spain');
  });

  it('drops region when it equals the city (Madrid in Madrid)', async () => {
    mockedReverse.mockResolvedValue(place()); // Madrid, admin1Name=Madrid
    expect(await reverseGeocode(40.4168, -3.7038)).toBe('Madrid, Spain');
  });

  it('falls back to country code when admin1Name is missing', async () => {
    mockedReverse.mockResolvedValue(
      place({ name: 'Cambre', admin1Name: null, countryName: 'Spain' })
    );
    expect(await reverseGeocode(43.29, -8.34)).toBe('Cambre, ES, Spain');
  });

  it('skips region when it equals the city name', async () => {
    mockedReverse.mockResolvedValue(
      place({ name: 'Singapore', admin1Name: 'Singapore', countryName: 'Singapore' })
    );
    expect(await reverseGeocode(1.29, 103.85)).toBe('Singapore');
  });

  it('memoizes identical lookups so the native call fires once', async () => {
    mockedReverse.mockResolvedValue(place());
    await reverseGeocode(40.4168, -3.7038);
    await reverseGeocode(40.4168, -3.7038);
    await reverseGeocode(40.4168, -3.7038);
    expect(mockedReverse).toHaveBeenCalledTimes(1);
  });
});

describe('OfflineGeocoder.listAvailableCountryPacks', () => {
  it('parses a geo- release into country-pack listings', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'geo-20260426',
          assets: [
            { name: 'cities15000.db.gz', size: 1700000, browser_download_url: 'https://x/cities' },
            { name: 'US.db.gz', size: 80_000_000, browser_download_url: 'https://x/US' },
            { name: 'ES.db.gz', size: 9_000_000, browser_download_url: 'https://x/ES' },
            { name: 'README.md', size: 100, browser_download_url: 'https://x/r' },
          ],
        },
      ],
    });
    const packs = await listAvailableCountryPacks();
    expect(packs).toHaveLength(2);
    const isos = packs.map((p) => p.iso).sort();
    expect(isos).toEqual(['ES', 'US']);
    const us = packs.find((p) => p.iso === 'US')!;
    expect(us.name).toBe('United States');
    expect(us.snapshotDate).toBe('2026-04-26');
    expect(us.downloadUrl).toBe('https://x/US');
  });

  it('returns [] when the network request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await listAvailableCountryPacks()).toEqual([]);
  });

  it('returns [] when no release tag matches geo-*', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'v1.0.0', assets: [] }],
    });
    expect(await listAvailableCountryPacks()).toEqual([]);
  });

  it('caches the response across calls', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'geo-20260426',
          assets: [
            { name: 'ES.db.gz', size: 9_000_000, browser_download_url: 'https://x/ES' },
          ],
        },
      ],
    });
    await listAvailableCountryPacks();
    await listAvailableCountryPacks();
    await listAvailableCountryPacks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('OfflineGeocoder.countryNameForIso', () => {
  it('maps known ISO codes to display names', () => {
    expect(countryNameForIso('US')).toBe('United States');
    expect(countryNameForIso('es')).toBe('Spain');
  });

  it('falls back to the upper-cased ISO when unknown', () => {
    expect(countryNameForIso('xy')).toBe('XY');
  });
});

describe('isGeoModuleAvailable hook check', () => {
  it('exposes the underlying mock', () => {
    expect(isGeoModuleAvailable()).toBe(true);
    mockedAvailable.mockReturnValue(false);
    expect(isGeoModuleAvailable()).toBe(false);
  });
});
