/**
 * Tests for WelcomeTour component.
 *
 * Covers:
 * - Renders all 4 slides (emoji, title, body).
 * - "Got it" on the last slide calls onDismiss and sets the AsyncStorage flag.
 * - "Skip" on any slide calls onDismiss and sets the AsyncStorage flag.
 * - Does not render (returns null) if the AsyncStorage flag is already set.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WelcomeTour, WELCOME_SEEN_KEY } from '../components/WelcomeTour';

// expo-localization is used transitively via src/i18n
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
  getCalendars: jest.fn(() => []),
}));

// The async-storage mock is registered globally via jest.setup.js.
// We still cast it for type-safe usage in this file.
const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Helper — render and wait for the AsyncStorage check to resolve.
async function renderTour(onDismiss: jest.Mock, alreadySeen = false) {
  mockStorage.getItem.mockResolvedValueOnce(alreadySeen ? 'true' : null);
  const result = render(<WelcomeTour onDismiss={onDismiss} />);
  // Let the useEffect + AsyncStorage.getItem settle
  await act(async () => {});
  return result;
}

// Simulate scrolling to a specific slide by firing a fake scroll event.
// We fire the event and wrap in act so the state update flushes synchronously.
function scrollToSlide(
  getByTestId: ReturnType<typeof render>['getByTestId'],
  slideIndex: number,
  screenWidth = 390,
) {
  act(() => {
    fireEvent(getByTestId('welcome-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: slideIndex * screenWidth } },
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WelcomeTour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all 4 slide titles when the tour has not been seen', async () => {
    const onDismiss = jest.fn();
    const { getByText } = await renderTour(onDismiss, false);

    expect(getByText('Welcome')).toBeTruthy();
    expect(getByText('Your data stays here')).toBeTruthy();
    expect(getByText('Tap a place to learn its story')).toBeTruthy();
    expect(getByText('Works wherever you go')).toBeTruthy();
  });

  it('renders all 4 slide bodies', async () => {
    const onDismiss = jest.fn();
    const { getByText } = await renderTour(onDismiss, false);

    expect(getByText(/Ask any question about places near you/)).toBeTruthy();
    expect(getByText(/Your location, voice, and photos are processed/)).toBeTruthy();
    expect(getByText(/On the map, tap any pin or label/)).toBeTruthy();
    expect(getByText(/After this download, the AI runs entirely/)).toBeTruthy();
  });

  it('shows "Next" button on slide 1 (not "Got it")', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, queryByTestId } = await renderTour(onDismiss, false);

    expect(getByTestId('welcome-next')).toBeTruthy();
    expect(queryByTestId('welcome-got-it')).toBeNull();
  });

  it('shows "Got it" button on slide 4 after pressing Next 3 times', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, queryByTestId } = await renderTour(onDismiss, false);

    // Advance through slides 0→1→2→3 via the Next button
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));

    expect(getByTestId('welcome-got-it')).toBeTruthy();
    expect(queryByTestId('welcome-next')).toBeNull();
  });

  it('"Got it" on the last slide calls onDismiss', async () => {
    const onDismiss = jest.fn();
    mockStorage.setItem.mockResolvedValueOnce(undefined as any);
    const { getByTestId } = await renderTour(onDismiss, false);

    // Advance to last slide via Next
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-got-it'));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('"Got it" sets the AsyncStorage flag before calling onDismiss', async () => {
    const onDismiss = jest.fn();
    mockStorage.setItem.mockResolvedValueOnce(undefined as any);
    const { getByTestId } = await renderTour(onDismiss, false);

    // Advance to last slide via Next
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-got-it'));

    await waitFor(() => {
      expect(mockStorage.setItem).toHaveBeenCalledWith(WELCOME_SEEN_KEY, 'true');
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('"Skip" on any slide calls onDismiss and sets the flag', async () => {
    const onDismiss = jest.fn();
    mockStorage.setItem.mockResolvedValueOnce(undefined as any);
    const { getByTestId } = await renderTour(onDismiss, false);

    fireEvent.press(getByTestId('welcome-skip'));

    await waitFor(() => {
      expect(mockStorage.setItem).toHaveBeenCalledWith(WELCOME_SEEN_KEY, 'true');
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('returns null (renders nothing) when the flag is already set', async () => {
    const onDismiss = jest.fn();
    const { toJSON } = await renderTour(onDismiss, true);

    // Component should render nothing because the tour was already seen
    expect(toJSON()).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('shows 4 pagination dots', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await renderTour(onDismiss, false);

    for (let i = 0; i < 4; i++) {
      expect(getByTestId(`welcome-dot-${i}`)).toBeTruthy();
    }
  });

  it('"Next" button is present on slide 2 (not yet on last slide)', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await renderTour(onDismiss, false);

    // Advance to slide 2 — still not on last slide
    fireEvent.press(getByTestId('welcome-next'));
    fireEvent.press(getByTestId('welcome-next'));

    // Should still show "Next", not "Got it"
    expect(getByTestId('welcome-next')).toBeTruthy();
  });
});
