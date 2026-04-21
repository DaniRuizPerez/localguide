/**
 * VoiceRateControls (C2) — the narration settings bottom sheet.
 * Verifies it mirrors narrationPrefs, populates a locale-filtered voice list,
 * and writes the chosen voice back to narrationPrefs.
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

import { VoiceRateControls } from '../components/VoiceRateControls';
import { narrationPrefs } from '../services/NarrationPrefs';

// The sheet now carries every Chat-screen setting, not just voice/rate, so
// tests need to pass the full prop bag. Shared defaults so each render stays
// readable — override individual keys in a test with {...defaults, ...}.
const defaultProps = {
  visible: true as boolean,
  onClose: () => {},
  autoGuide: false,
  onAutoGuideChange: () => {},
  speak: true,
  onSpeakChange: () => {},
  hiddenGems: false,
  onHiddenGemsChange: () => {},
  radiusMeters: 1000,
  onRadiusChange: () => {},
};

describe('VoiceRateControls', () => {
  beforeEach(() => {
    mockGetAvailableVoices.mockReset();
    narrationPrefs.__resetForTest();
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
      { identifier: 'en-us-x-a', name: 'Voice A', language: 'en-US' },
      { identifier: 'fr-fr-x-b', name: 'Voice B', language: 'fr-FR' },
      { identifier: 'en-gb-x-c', name: 'Voice C', language: 'en-GB' },
    ]);

    const { findByText, queryByText } = render(
      <VoiceRateControls {...defaultProps} />
    );

    expect(await findByText('Voice A')).toBeTruthy();
    expect(await findByText('Voice C')).toBeTruthy();
    expect(queryByText('Voice B')).toBeNull();
  });

  it('setting a voice chip updates narrationPrefs', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-a', name: 'Voice A', language: 'en-US' },
    ]);

    const { findByText } = render(
      <VoiceRateControls {...defaultProps} />
    );
    const chip = await findByText('Voice A');
    await act(async () => {
      fireEvent.press(chip);
    });
    expect(narrationPrefs.get().voice).toBe('en-us-x-a');
  });

  it('always offers a "System default" option that clears the custom voice', async () => {
    mockGetAvailableVoices.mockResolvedValue([
      { identifier: 'en-us-x-a', name: 'Voice A', language: 'en-US' },
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
});
