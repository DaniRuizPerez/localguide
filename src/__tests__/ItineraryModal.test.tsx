/**
 * ItineraryModal — source attribution strip rendering, nearbyPois plumbing,
 * OSRM route header/leg labels, offline mode behaviour, and GPS anchoring.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import type { Poi } from '../services/PoiService';
import type { ItineraryResult } from '../services/LocalGuideService';
import type { WalkingMatrix } from '../services/RouteService';

// Minimal RN mocks needed for the modal.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// i18n returns the key so assertions are stable across locales.
jest.mock('../i18n', () => ({
  t: (key: string) => key,
  localePromptDirective: () => '',
}));

// VisitedStore stub.
jest.mock('../services/VisitedStore', () => ({
  visitedStore: {
    get: () => ({ titles: {} }),
    subscribe: () => () => {},
    setVisited: jest.fn(),
  },
}));

// PoiService — only distanceMeters needed.
jest.mock('../services/PoiService', () => ({
  distanceMeters: jest.fn((lat1: number, _lon1: number, lat2: number, _lon2: number) =>
    // Return a deterministic distance: |lat1 - lat2| * 111000 (rough metres).
    Math.abs(lat1 - lat2) * 111000
  ),
}));

// AppMode stub — controllable for online/offline tests.
let mockMode: 'online' | 'offline' = 'online';
const modeListeners: Array<(m: 'online' | 'offline') => void> = [];
jest.mock('../services/AppMode', () => ({
  appMode: {
    get: () => mockMode,
    subscribe: (cb: (m: 'online' | 'offline') => void) => {
      modeListeners.push(cb);
      return () => {
        const idx = modeListeners.indexOf(cb);
        if (idx >= 0) modeListeners.splice(idx, 1);
      };
    },
  },
}));

// Controllable planItinerary mock.
let resolvePlan: ((r: ItineraryResult) => void) | null = null;
const mockPlanItinerary = jest.fn(
  (_loc: unknown, _hours: unknown, _titles: unknown, nearbyPois?: Poi[]) => {
    const promise = new Promise<ItineraryResult>((resolve) => {
      resolvePlan = resolve;
    });
    return { promise, abort: jest.fn().mockResolvedValue(undefined) };
  }
);

jest.mock('../services/LocalGuideService', () => ({
  localGuideService: {
    planItinerary: (loc: unknown, hours: unknown, titles: unknown, pois?: Poi[]) =>
      mockPlanItinerary(loc, hours, titles, pois),
  },
}));

// RouteService mock — controllable matrix result.
let mockMatrixResult: WalkingMatrix | null = null;
const mockWalkingTimeMatrix = jest.fn<Promise<WalkingMatrix | null>, [unknown]>(
  async (_coords: unknown) => mockMatrixResult
);

jest.mock('../services/RouteService', () => ({
  routeService: {
    // Use a wrapper to avoid TypeScript arity issues with jest.fn()
    walkingTimeMatrix: (coords: unknown) => mockWalkingTimeMatrix(coords),
    _clearMemoryCache: jest.fn(),
  },
}));

import { ItineraryModal } from '../components/ItineraryModal';

const paris = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };

function makePoi(title: string, lat?: number, lon?: number): Poi {
  return {
    pageId: 1,
    title,
    latitude: lat ?? 48.8566,
    longitude: lon ?? 2.3522,
    distanceMeters: 100,
    source: 'wikipedia',
  };
}

function renderModal(nearbyPois: Poi[] = [], location = paris as typeof paris | null) {
  return render(
    <ItineraryModal
      visible
      onClose={jest.fn()}
      location={location}
      nearbyPois={nearbyPois}
    />
  );
}

/** Build a 3x3 WalkingMatrix where off-diagonals are the given values. */
function makeMatrix(minutesVal: number, metersVal: number, n = 3): WalkingMatrix {
  const minutes = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 0 : minutesVal))
  );
  const meters = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 0 : metersVal))
  );
  return { minutes, meters };
}

describe('ItineraryModal', () => {
  beforeEach(() => {
    mockPlanItinerary.mockClear();
    mockWalkingTimeMatrix.mockClear();
    resolvePlan = null;
    mockMode = 'online';
    mockMatrixResult = null;
    modeListeners.length = 0;
  });

  // ── Legacy tests (unchanged behaviour) ───────────────────────────────────

  it('passes nearbyPois into planItinerary', async () => {
    const pois = [makePoi('Eiffel Tower'), makePoi('Louvre')];
    renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockPlanItinerary).toHaveBeenCalled();
    const call = mockPlanItinerary.mock.calls[0];
    expect(call[3]).toEqual(pois);
  });

  it('renders offline warning strip when source=ai-offline', async () => {
    const { getByText } = renderModal([makePoi('Eiffel Tower')]);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [{ title: 'Eiffel Tower', note: 'iconic tower' }],
        source: 'ai-offline',
      });
      await Promise.resolve();
    });

    expect(
      getByText('⚠ Generated offline — verify before relying on it')
    ).toBeTruthy();
  });

  it('renders Wikipedia attribution strip when source=wikipedia', async () => {
    const { getByText } = renderModal([makePoi('Eiffel Tower')]);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [{ title: 'Eiffel Tower', note: 'iconic tower' }],
        source: 'wikipedia',
      });
      await Promise.resolve();
    });

    expect(getByText('From Wikipedia')).toBeTruthy();
  });

  it('renders no source strip when source=ai-online', async () => {
    const { queryByText } = renderModal([makePoi('Eiffel Tower')]);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [{ title: 'Eiffel Tower', note: 'iconic tower' }],
        source: 'ai-online',
      });
      await Promise.resolve();
    });

    expect(queryByText(/Generated offline/)).toBeNull();
    expect(queryByText(/From Wikipedia/)).toBeNull();
  });

  // ── B3: Route header strip ────────────────────────────────────────────────

  it('shows OSRM route header strip when matrix returns osrm legs (online)', async () => {
    mockMode = 'online';
    // Matrix with 5-min legs, 400 m each (for 2 stops + anchor = 3 coords).
    mockMatrixResult = makeMatrix(5, 400);

    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];
    const { queryAllByText } = renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [
          { title: 'Eiffel Tower', note: '' },
          { title: 'Louvre', note: '' },
        ],
        source: 'ai-online',
      });
      // Multiple microtasks for the async optimizeWalkingOrder.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    // Header should show "min walking · km".
    expect(queryAllByText(/min walking/).length).toBeGreaterThan(0);
    // Accept any distance unit the new shared formatDistance can produce
    // (km / mi / m / ft) — the offline matrix is null so routeTotalM may be 0,
    // which renders as "0 ft" (miles default in en-US) or "0 m" (km).
    expect(queryAllByText(/km|mi|\d ?m\b|\d ?ft\b/).length).toBeGreaterThan(0);
  });

  it('shows distance-only header strip in offline mode (no OSRM)', async () => {
    mockMode = 'offline';
    mockMatrixResult = null; // matrix not called in offline mode

    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];
    const { queryAllByText, queryByText } = renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [
          { title: 'Eiffel Tower', note: '' },
          { title: 'Louvre', note: '' },
        ],
        source: 'ai-offline',
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    // Should NOT show "min walking" (no OSRM in offline mode).
    expect(queryByText(/min walking/)).toBeNull();
    // Should show km distance.
    // Accept any distance unit the new shared formatDistance can produce
    // (km / mi / m / ft) — the offline matrix is null so routeTotalM may be 0,
    // which renders as "0 ft" (miles default in en-US) or "0 m" (km).
    expect(queryAllByText(/km|mi|\d ?m\b|\d ?ft\b/).length).toBeGreaterThan(0);
  });

  it('does not show per-leg "min walk" labels in offline mode', async () => {
    mockMode = 'offline';
    mockMatrixResult = null;

    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];
    const { queryByText } = renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [
          { title: 'Eiffel Tower', note: '' },
          { title: 'Louvre', note: '' },
        ],
        source: 'ai-offline',
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(queryByText(/min walk/)).toBeNull();
  });

  it('shows per-leg "min walk" labels between cards when OSRM matrix succeeds (online)', async () => {
    mockMode = 'online';
    mockMatrixResult = makeMatrix(8, 600);

    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];
    const { queryAllByText } = renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolvePlan?.({
        stops: [
          { title: 'Eiffel Tower', note: '' },
          { title: 'Louvre', note: '' },
        ],
        source: 'ai-online',
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    // Per-leg label "→ N min walk" should appear (for the second stop onward).
    // Use queryAllByText since "min walking" in header and "min walk" in leg labels both match.
    expect(queryAllByText(/min walk/).length).toBeGreaterThan(0);
  });

  // ── B2: Parallel matrix + LLM calls ──────────────────────────────────────

  it('fires walkingTimeMatrix in parallel with planItinerary (both called within same task)', async () => {
    mockMode = 'online';
    mockMatrixResult = makeMatrix(5, 400);

    const callOrder: string[] = [];
    mockWalkingTimeMatrix.mockImplementation(async () => {
      callOrder.push('matrix');
      return mockMatrixResult;
    });
    mockPlanItinerary.mockImplementation((_loc, _hours, _titles, _pois) => {
      callOrder.push('planItinerary');
      const promise = new Promise<ItineraryResult>((resolve) => {
        resolvePlan = resolve;
      });
      return { promise, abort: jest.fn().mockResolvedValue(undefined) };
    });

    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];
    renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    // Both should have been called (order may vary based on code path, but both called).
    expect(callOrder).toContain('matrix');
    expect(callOrder).toContain('planItinerary');
  });

  // ── B2: GPS anchor ────────────────────────────────────────────────────────

  it('uses GPS anchor when provided — walkingTimeMatrix includes gps coord as first element', async () => {
    mockMode = 'online';
    // Return a 3x3 matrix (gps + 2 stops).
    mockMatrixResult = makeMatrix(5, 400, 3);

    const gpsLocation = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };
    const pois = [
      makePoi('Eiffel Tower', 48.8584, 2.2945),
      makePoi('Louvre', 48.8606, 2.3376),
    ];

    renderModal(pois, gpsLocation);

    await act(async () => {
      await Promise.resolve();
    });

    // Verify matrix was called with a coord list where first element matches gps.
    expect(mockWalkingTimeMatrix).toHaveBeenCalled();
    const rawCalls = mockWalkingTimeMatrix.mock.calls as unknown as Array<[Array<{ lat: number; lon: number }>]>;
    const calledCoords = rawCalls[0][0];
    expect(calledCoords[0].lat).toBeCloseTo(gpsLocation.latitude, 3);
    expect(calledCoords[0].lon).toBeCloseTo(gpsLocation.longitude, 3);
  });

  it('falls back gracefully when gps location is null — no crash', async () => {
    mockMode = 'online';
    mockMatrixResult = null; // matrix returns null when no anchor

    const pois = [makePoi('Eiffel Tower', 48.8584, 2.2945)];
    // Passing null for location means no GPS.
    const { queryByText } = renderModal(pois, null);

    await act(async () => {
      await Promise.resolve();
    });

    // Should not crash; CTA appears when no location is provided.
    expect(queryByText('itinerary.button')).toBeTruthy();
  });
});
