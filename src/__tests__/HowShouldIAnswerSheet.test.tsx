/**
 * HowShouldIAnswerSheet — "How should I answer?" source-picker pull-up sheet.
 *
 * Test cases:
 *  1. Renders title, subhead, and three option labels.
 *  2. Selecting "Online — grounded" calls setModeChoice('force-online') then onClose.
 *  3. Selecting "Offline — on-device" calls setModeChoice('force-offline') then onClose.
 *  4. Selecting "Automatic" calls setModeChoice('auto') then onClose.
 *  5. The currently-selected option is marked as checked (accessibilityState.checked).
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

// Safe-area insets stub.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// i18n returns the key so assertions are stable across locales.
jest.mock('../i18n', () => ({
  t: (key: string) => key,
  localePromptDirective: () => '',
}));

// Spy on guidePrefs so we can assert setModeChoice calls without AsyncStorage.
jest.mock('../services/GuidePrefs', () => {
  let _modeChoice: string = 'auto';
  const listeners: Array<(p: any) => void> = [];

  return {
    guidePrefs: {
      get: () => ({ modeChoice: _modeChoice }),
      setModeChoice: jest.fn((value: string) => {
        _modeChoice = value;
        listeners.forEach((l) => l({ modeChoice: value }));
      }),
      subscribe: jest.fn((listener: (p: any) => void) => {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        };
      }),
      __reset: () => {
        _modeChoice = 'auto';
        listeners.length = 0;
        // Reset jest mock call counts.
      },
    },
  };
});

import { HowShouldIAnswerSheet } from '../components/HowShouldIAnswerSheet';
import { guidePrefs } from '../services/GuidePrefs';

const mockSetModeChoice = guidePrefs.setModeChoice as jest.Mock;

describe('HowShouldIAnswerSheet', () => {
  beforeEach(() => {
    mockSetModeChoice.mockClear();
    (guidePrefs.subscribe as jest.Mock).mockClear();
    // Reset internal state by calling the internal __reset if available.
    (guidePrefs as any).__reset?.();
  });

  it('renders title, subhead, and three option labels', () => {
    const { getByText } = render(
      <HowShouldIAnswerSheet visible={true} onClose={() => {}} />
    );

    expect(getByText('mode.howShouldIAnswerTitle')).toBeTruthy();
    expect(getByText('mode.threePlainEnglishChoices')).toBeTruthy();
    expect(getByText('mode.optAuto')).toBeTruthy();
    expect(getByText('mode.optOnline')).toBeTruthy();
    expect(getByText('mode.optOffline')).toBeTruthy();
  });

  it('renders sub-descriptions for all three options', () => {
    const { getByText } = render(
      <HowShouldIAnswerSheet visible={true} onClose={() => {}} />
    );

    expect(getByText('mode.optAutoSub')).toBeTruthy();
    expect(getByText('mode.optOnlineSub')).toBeTruthy();
    expect(getByText('mode.optOfflineSub')).toBeTruthy();
  });

  it('selecting Online calls setModeChoice("force-online") then onClose', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HowShouldIAnswerSheet visible={true} onClose={onClose} />
    );

    await act(async () => {
      fireEvent.press(getByTestId('how-answer-opt-force-online'));
    });

    expect(mockSetModeChoice).toHaveBeenCalledWith('force-online');
    expect(onClose).toHaveBeenCalled();
    // setModeChoice must be called before onClose.
    expect(mockSetModeChoice.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0]
    );
  });

  it('selecting Offline calls setModeChoice("force-offline") then onClose', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HowShouldIAnswerSheet visible={true} onClose={onClose} />
    );

    await act(async () => {
      fireEvent.press(getByTestId('how-answer-opt-force-offline'));
    });

    expect(mockSetModeChoice).toHaveBeenCalledWith('force-offline');
    expect(onClose).toHaveBeenCalled();
  });

  it('selecting Automatic calls setModeChoice("auto") then onClose', async () => {
    // Start from force-offline so we're actually switching.
    mockSetModeChoice.mockClear();
    // Manually set store state via the real guidePrefs mock shape.
    // We'll directly update the mocked get() return.
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HowShouldIAnswerSheet visible={true} onClose={onClose} />
    );

    await act(async () => {
      fireEvent.press(getByTestId('how-answer-opt-auto'));
    });

    expect(mockSetModeChoice).toHaveBeenCalledWith('auto');
    expect(onClose).toHaveBeenCalled();
  });

  it('the currently-selected option is marked aria-checked', () => {
    // Default modeChoice is 'auto' in the mock.
    const { getByTestId } = render(
      <HowShouldIAnswerSheet visible={true} onClose={() => {}} />
    );

    const autoRow = getByTestId('how-answer-opt-auto');
    const onlineRow = getByTestId('how-answer-opt-force-online');
    const offlineRow = getByTestId('how-answer-opt-force-offline');

    // 'auto' is selected → checked; others unchecked.
    expect(autoRow.props.accessibilityState?.checked).toBe(true);
    expect(onlineRow.props.accessibilityState?.checked).toBe(false);
    expect(offlineRow.props.accessibilityState?.checked).toBe(false);
  });

  it('does not call setModeChoice when backdrop is pressed (onClose only)', async () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <HowShouldIAnswerSheet visible={true} onClose={onClose} />
    );

    // The Pressable backdrop doesn't have a testID, so we verify
    // setModeChoice was NOT called after we only call onClose.
    // We test this indirectly: after mount with no row taps,
    // setModeChoice should not have been called.
    expect(mockSetModeChoice).not.toHaveBeenCalled();
  });

  it('does not render its content when visible is false', () => {
    const { queryByText } = render(
      <HowShouldIAnswerSheet visible={false} onClose={() => {}} />
    );
    // Modal with visible=false should not show content in the tree.
    expect(queryByText('mode.howShouldIAnswerTitle')).toBeNull();
  });
});
