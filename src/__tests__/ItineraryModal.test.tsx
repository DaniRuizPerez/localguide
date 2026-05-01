/**
 * ItineraryModal — source attribution strip rendering and nearbyPois plumbing.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import type { Poi } from '../services/PoiService';
import type { ItineraryResult } from '../services/LocalGuideService';

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

// PoiService — only distanceMeters needed for the optimizeWalkingOrder helper.
jest.mock('../services/PoiService', () => ({
  distanceMeters: jest.fn(() => 100),
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

import { ItineraryModal } from '../components/ItineraryModal';

const paris = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };

function makePoi(title: string): Poi {
  return {
    pageId: 1,
    title,
    latitude: 48.8566,
    longitude: 2.3522,
    distanceMeters: 100,
    source: 'wikipedia',
  };
}

function renderModal(nearbyPois: Poi[] = []) {
  return render(
    <ItineraryModal
      visible
      onClose={jest.fn()}
      location={paris}
      nearbyPois={nearbyPois}
    />
  );
}

describe('ItineraryModal', () => {
  beforeEach(() => {
    mockPlanItinerary.mockClear();
    resolvePlan = null;
  });

  it('passes nearbyPois into planItinerary', async () => {
    const pois = [makePoi('Eiffel Tower'), makePoi('Louvre')];
    renderModal(pois);

    await act(async () => {
      await Promise.resolve();
    });

    // The 4th arg to planItinerary should be the nearbyPois array.
    expect(mockPlanItinerary).toHaveBeenCalled();
    const call = mockPlanItinerary.mock.calls[0];
    expect(call[3]).toEqual(pois);
  });

  it('renders offline warning strip when source=ai-offline', async () => {
    const { getByText } = renderModal([makePoi('Eiffel Tower')]);

    await act(async () => {
      await Promise.resolve();
    });

    // Resolve plan with ai-offline source.
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
});
