/**
 * Tests for MapsService — Google Maps configuration helper.
 * Covers: isConfigured() key present / absent.
 * (walkingTime / walkingTimes were removed; routing is handled by OSRM
 * via RouteService.)
 */

import { mapsService } from '../services/MapsService';

// ─── Mock expo-constants ────────────────────────────────────────────────────

let mockApiKey: string | null = 'TEST_KEY_123';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockApiKey !== null
        ? { extra: { googleMapsApiKey: mockApiKey } }
        : { extra: { googleMapsApiKey: '' } };
    },
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiKey = 'TEST_KEY_123';
});

describe('isConfigured()', () => {
  it('returns true when a non-empty API key is present', () => {
    mockApiKey = 'MY_KEY';
    expect(mapsService.isConfigured()).toBe(true);
  });

  it('returns false when the key is absent', () => {
    mockApiKey = null;
    expect(mapsService.isConfigured()).toBe(false);
  });
});
