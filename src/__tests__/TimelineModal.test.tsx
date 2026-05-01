/**
 * TimelineModal — source-attribution strip rendering.
 *
 * Covers the three source variants that buildTimeline now returns:
 *   'wikipedia'   → "From Wikipedia" attribution strip
 *   'ai-offline'  → "Generated offline" warning strip
 *   'ai-online'   → no strip (existing badge surfaces it)
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { TimelineModal } from '../components/TimelineModal';

// Mock LocalGuideService so we can control what buildTimeline resolves to.
const mockBuildTimeline = jest.fn();
jest.mock('../services/LocalGuideService', () => ({
  localGuideService: {
    buildTimeline: (...args: any[]) => mockBuildTimeline(...args),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
}));

// i18n: return the key as-is so tests don't depend on translation strings.
jest.mock('../i18n', () => ({
  t: (key: string) => key,
  localePromptDirective: () => '',
}));

const THREE_EVENTS = [
  { year: '1889', event: 'Opened for the World Exhibition.' },
  { year: '1909', event: 'Nearly demolished but saved as a radio mast.' },
  { year: '1944', event: 'Elevators disabled during WWII occupation.' },
];

function makeTask(
  events: { year: string; event: string }[],
  source: 'wikipedia' | 'ai-online' | 'ai-offline'
) {
  return {
    promise: Promise.resolve({ events, source }),
    abort: jest.fn(),
  };
}

describe('TimelineModal source strips', () => {
  beforeEach(() => {
    mockBuildTimeline.mockClear();
  });

  it('renders the offline warning strip when source=ai-offline', async () => {
    mockBuildTimeline.mockReturnValue(makeTask(THREE_EVENTS, 'ai-offline'));

    const { queryByTestId } = render(
      <TimelineModal
        visible
        onClose={jest.fn()}
        poiTitle="Eiffel Tower"
        location={null}
      />
    );

    await act(async () => {});

    expect(queryByTestId('offline-strip')).not.toBeNull();
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });

  it('renders the Wikipedia attribution strip when source=wikipedia', async () => {
    mockBuildTimeline.mockReturnValue(makeTask(THREE_EVENTS, 'wikipedia'));

    const { queryByTestId } = render(
      <TimelineModal
        visible
        onClose={jest.fn()}
        poiTitle="Eiffel Tower"
        location={null}
      />
    );

    await act(async () => {});

    expect(queryByTestId('wikipedia-strip')).not.toBeNull();
    expect(queryByTestId('offline-strip')).toBeNull();
  });

  it('renders no source strip when source=ai-online', async () => {
    mockBuildTimeline.mockReturnValue(makeTask(THREE_EVENTS, 'ai-online'));

    const { queryByTestId } = render(
      <TimelineModal
        visible
        onClose={jest.fn()}
        poiTitle="Eiffel Tower"
        location={null}
      />
    );

    await act(async () => {});

    expect(queryByTestId('offline-strip')).toBeNull();
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });

  it('does not call buildTimeline when poiTitle is null', () => {
    render(
      <TimelineModal
        visible
        onClose={jest.fn()}
        poiTitle={null}
        location={null}
      />
    );

    expect(mockBuildTimeline).not.toHaveBeenCalled();
  });

  it('does not call buildTimeline when not visible', () => {
    render(
      <TimelineModal
        visible={false}
        onClose={jest.fn()}
        poiTitle="Eiffel Tower"
        location={null}
      />
    );

    expect(mockBuildTimeline).not.toHaveBeenCalled();
  });
});
