/**
 * B1 — CompassArrow component: bearing math, rendering, distance formatting.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

const mockAddListener = jest.fn();
const mockIsAvailable = jest.fn().mockResolvedValue(true);
const mockSetUpdateInterval = jest.fn();

jest.mock('expo-sensors', () => ({
  Magnetometer: {
    isAvailableAsync: () => mockIsAvailable(),
    setUpdateInterval: (...args: unknown[]) => mockSetUpdateInterval(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
  },
}));

import { CompassArrow, bearingDegrees, haversineMeters } from '../components/CompassArrow';

describe('bearingDegrees', () => {
  it('due north is 0°', () => {
    expect(bearingDegrees(0, 0, 1, 0)).toBeCloseTo(0, 1);
  });

  it('due east is 90°', () => {
    // At the equator moving east
    expect(bearingDegrees(0, 0, 0, 1)).toBeCloseTo(90, 1);
  });

  it('due south is 180°', () => {
    expect(bearingDegrees(0, 0, -1, 0)).toBeCloseTo(180, 1);
  });

  it('due west is 270°', () => {
    expect(bearingDegrees(0, 0, 0, -1)).toBeCloseTo(270, 1);
  });

  it('always returns a value in [0, 360)', () => {
    const cases: Array<[number, number, number, number]> = [
      [48.8566, 2.3522, 48.8584, 2.2945], // Paris: Eiffel → Arc
      [40.712776, -74.005974, 40.748817, -73.985428], // NYC: downtown → Empire
      [-33.8688, 151.2093, -33.85, 151.2],
    ];
    for (const [lat1, lon1, lat2, lon2] of cases) {
      const b = bearingDegrees(lat1, lon1, lat2, lon2);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('haversineMeters', () => {
  it('zero for identical points', () => {
    expect(haversineMeters(48.8566, 2.3522, 48.8566, 2.3522)).toBeCloseTo(0, 3);
  });

  it('Paris → London is about 344 km', () => {
    const d = haversineMeters(48.8566, 2.3522, 51.5074, -0.1278);
    expect(d / 1000).toBeGreaterThan(340);
    expect(d / 1000).toBeLessThan(350);
  });
});

describe('<CompassArrow />', () => {
  beforeEach(() => {
    mockAddListener.mockReset().mockImplementation(() => ({ remove: jest.fn() }));
  });

  it('renders the POI label and a formatted distance', () => {
    const { getByText } = render(
      <CompassArrow
        targetLat={48.8584}
        targetLon={2.2945}
        userLat={48.8566}
        userLon={2.3522}
        label="Arc de Triomphe"
      />
    );
    expect(getByText('Arc de Triomphe')).toBeTruthy();
    // ~4 km between Eiffel and Arc, format as "4.X km"
    expect(getByText(/km$/)).toBeTruthy();
  });

  it('formats short distances in metres', () => {
    const { getByText } = render(
      <CompassArrow
        targetLat={48.8566}
        targetLon={2.3523}
        userLat={48.8566}
        userLon={2.3522}
        label="Next door"
      />
    );
    expect(getByText(/m$/)).toBeTruthy();
  });

  it('subscribes to the magnetometer when enabled', () => {
    render(
      <CompassArrow
        targetLat={0.1}
        targetLon={0.1}
        userLat={0}
        userLon={0}
        label="Target"
        enabled={true}
      />
    );
    // Listener registration is async (after isAvailableAsync resolves).
    return new Promise<void>((resolve) => setImmediate(resolve)).then(() => {
      expect(mockAddListener).toHaveBeenCalled();
    });
  });

  it('does not subscribe when disabled', () => {
    render(
      <CompassArrow
        targetLat={0.1}
        targetLon={0.1}
        userLat={0}
        userLon={0}
        label="Target"
        enabled={false}
      />
    );
    expect(mockAddListener).not.toHaveBeenCalled();
  });
});
