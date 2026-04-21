/**
 * PlaybackControls (C5) — visibility + button routing to SpeechService.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
  getAvailableVoicesAsync: jest.fn().mockResolvedValue([]),
}));

import { PlaybackControls } from '../components/PlaybackControls';
import { speechService } from '../services/SpeechService';
import { narrationPrefs } from '../services/NarrationPrefs';

describe('PlaybackControls', () => {
  beforeEach(() => {
    narrationPrefs.__resetForTest();
    speechService.stop();
    jest.clearAllMocks();
  });

  it('renders nothing when idle', () => {
    const { queryByLabelText, toJSON } = render(<PlaybackControls />);
    expect(queryByLabelText(/pause/i)).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('shows Pause button while speaking', async () => {
    const { findByLabelText } = render(<PlaybackControls />);
    await act(async () => {
      speechService.enqueue('Hello world.');
    });
    expect(await findByLabelText('Pause')).toBeTruthy();
  });

  it('swaps Pause → Resume when user pauses', async () => {
    const { findByLabelText, queryByLabelText } = render(<PlaybackControls />);
    await act(async () => {
      speechService.enqueue('Some narration.');
    });

    const pauseBtn = await findByLabelText('Pause');
    await act(async () => {
      fireEvent.press(pauseBtn);
    });

    // Simulate expo-speech onStopped fired by the mock
    const Speech = require('expo-speech');
    const lastCall = Speech.speak.mock.calls[Speech.speak.mock.calls.length - 1];
    await act(async () => {
      lastCall?.[1]?.onStopped?.();
    });

    expect(await findByLabelText('Resume')).toBeTruthy();
    expect(queryByLabelText('Pause')).toBeNull();
  });

  it('skip button routes to speechService.skipCurrent', async () => {
    const spy = jest.spyOn(speechService, 'skipCurrent');
    const { findByLabelText } = render(<PlaybackControls />);
    await act(async () => {
      speechService.enqueue('First.');
      speechService.enqueue('Second.');
    });
    const skipBtn = await findByLabelText('Skip');
    fireEvent.press(skipBtn);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('stop button clears narration', async () => {
    const { findByLabelText, queryByLabelText } = render(<PlaybackControls />);
    await act(async () => {
      speechService.enqueue('Anything.');
    });
    const stopBtn = await findByLabelText('STOP');
    await act(async () => {
      fireEvent.press(stopBtn);
    });

    // All buttons should be gone now that the queue is clear + paused=false
    expect(queryByLabelText('Pause')).toBeNull();
    expect(queryByLabelText('Resume')).toBeNull();
  });
});
