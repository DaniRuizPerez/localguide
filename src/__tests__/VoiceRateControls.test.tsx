/**
 * VoiceRateControls (C2) — the narration + connection settings bottom sheet.
 * Verifies it mirrors narrationPrefs, populates a locale-filtered voice list,
 * writes the chosen voice back to narrationPrefs, and the new CONNECTION
 * segmented control writes modeChoice via guidePrefs.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetAvailableVoices = jest.fn();

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
  getAvailableVoicesAsync: () => mockGetAvailableVoices(),
}));

// react-native-community/slider is a native module; stub it as a no-op View
// carrying the relevant props so we can inspect min/max/value.
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => React.createElement(View, { testID: 'rate-slider', ...props }),
  };
});

// Mock useNetworkStatus so NetworkStatusRow renders deterministically.
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(() => 'online' as const),
}));

import { VoiceRateControls } from '../components/VoiceRateControls';
import { narrationPrefs } from '../services/NarrationPrefs';
import { guidePrefs } from '../services/GuidePrefs';

// The sheet no longer receives offlineMode/onOfflineModeChange — it reads from
// the store directly. Shared defaults so each render stays readable.
const defaultProps = {
  visible: true as boolean,
  onClose: () => {},
  autoGuide: false,
  onAutoGuideChange: () => {},
  speak: true,
  onSpeakChange: () => {},
  hiddenGems: false,
  onHiddenGemsChange: () => {},
  topics: ['everything' as const],
  onTopicsChange: () => {},
  radiusMeters: 1000,
  onRadiusChange: () => {},
};

describe('VoiceRateControls', () => {
  beforeEach(() => {
    mockGetAvailableVoices.mockReset();
    narrationPrefs.__resetForTest();
    guidePrefs.__resetForTest();
  });

  it('renders rate slider reflecting current prefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByTestId } = render(<VoiceRateControls {...defaultProps} />);
    const slider = getByTestId('rate-slider');
    expect(slider.props.value).toBeCloseTo(0.95);
    expect(slider.props.minimumValue).toBeCloseTo(0.6);
    expect(slider.props.maximumValue).toBeCloseTo(1.6);
  });

  it('filters voices to the current locale (default en-US keeps en-* voices)', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-a', name: 'raw-en-us', language: 'en-US' },
      { identifier: 'fr-fr-x-b', name: 'raw-fr', language: 'fr-FR' },
      { identifier: 'en-gb-x-c', name: 'raw-en-gb', language: 'en-GB' },
    ]);

    // Post-humanize: chip labels carry the BCP-47 locale and gender when
    // we can infer it. The OS names in this test have no gender signal, so
    // the two surviving voices render as "en-GB voice" and "en-US voice".
    // The French voice is locale-filtered out.
    const { findByText, queryByText } = render(<VoiceRateControls {...defaultProps} />);

    expect(await findByText('en-US voice')).toBeTruthy();
    expect(await findByText('en-GB voice')).toBeTruthy();
    expect(queryByText(/raw-/)).toBeNull();
  });

  it('shows a gendered label when the OS identifier hints at gender', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-sfg#female_1-network', name: 'x', language: 'en-US' },
      { identifier: 'en-us-x-iol#male_1-network', name: 'x', language: 'en-US' },
    ]);

    const { findByText } = render(<VoiceRateControls {...defaultProps} />);
    expect(await findByText('en-US female')).toBeTruthy();
    expect(await findByText('en-US male')).toBeTruthy();
  });

  it('setting a voice chip writes its OS identifier to narrationPrefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-sfg#female_1-network', name: 'x', language: 'en-US' },
    ]);

    const { findByText } = render(<VoiceRateControls {...defaultProps} />);
    const chip = await findByText('en-US female');
    await act(async () => {
      fireEvent.press(chip);
    });
    // Label is human, but the persisted identifier is still the real one.
    expect(narrationPrefs.get().voice).toBe('en-us-x-sfg#female_1-network');
  });

  it('always offers a "System default" option that clears the custom voice', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-a', name: 'raw', language: 'en-US' },
    ]);

    narrationPrefs.setVoice('en-us-x-a');

    const { findByText } = render(<VoiceRateControls {...defaultProps} />);
    const defaultChip = await findByText('System default');
    await act(async () => {
      fireEvent.press(defaultChip);
    });
    expect(narrationPrefs.get().voice).toBeUndefined();
  });

  it('persists the slider value on sliding complete', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByTestId } = render(<VoiceRateControls {...defaultProps} />);
    await act(async () => {
      getByTestId('rate-slider').props.onSlidingComplete(1.25);
    });
    expect(narrationPrefs.get().rate).toBeCloseTo(1.25);
  });

  it('shows "no voices" hint when filter returns empty', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'ja-jp-x-a', name: 'Voice A', language: 'ja-JP' },
    ]);
    const { findByText } = render(<VoiceRateControls {...defaultProps} />);
    expect(await findByText(/No matching voices/i)).toBeTruthy();
  });

  it('calls onClose when the Done button is pressed', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const onClose = jest.fn();
    const { getByText } = render(<VoiceRateControls {...defaultProps} onClose={onClose} />);
    await waitFor(() => getByText('Done'));
    fireEvent.press(getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  // CONNECTION group tests
  it('shows the CONNECTION group with mode segmented control', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByText } = render(<VoiceRateControls {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('CONNECTION')).toBeTruthy();
      expect(getByText('Mode')).toBeTruthy();
      // Three mode options
      expect(getByText('Auto')).toBeTruthy();
      expect(getByText('Online')).toBeTruthy();
      expect(getByText('Offline')).toBeTruthy();
    });
  });

  it('selecting Online in segmented control writes force-online to guidePrefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByText } = render(<VoiceRateControls {...defaultProps} />);
    await waitFor(() => getByText('Online'));
    await act(async () => {
      fireEvent.press(getByText('Online'));
    });
    expect(guidePrefs.get().modeChoice).toBe('force-online');
  });

  it('selecting Offline in segmented control writes force-offline to guidePrefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByText } = render(<VoiceRateControls {...defaultProps} />);
    await waitFor(() => getByText('Offline'));
    await act(async () => {
      fireEvent.press(getByText('Offline'));
    });
    expect(guidePrefs.get().modeChoice).toBe('force-offline');
  });

  it('selecting Auto in segmented control writes auto to guidePrefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    // Start from force-offline so we can test switching back to auto.
    guidePrefs.setModeChoice('force-offline');
    const { getByText } = render(<VoiceRateControls {...defaultProps} />);
    await waitFor(() => getByText('Auto'));
    await act(async () => {
      fireEvent.press(getByText('Auto'));
    });
    expect(guidePrefs.get().modeChoice).toBe('auto');
  });

  it('shows the Network status row with online label when network is online', async () => {
    mockGetAvailableVoices.mockResolvedValue([]);
    const { getByText } = render(<VoiceRateControls {...defaultProps} />);
    await waitFor(() => {
      expect(getByText('Network')).toBeTruthy();
      expect(getByText('Reachable')).toBeTruthy();
    });
  });
});
