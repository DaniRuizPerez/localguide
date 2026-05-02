/**
 * Tests for SuggestionChips component and its integration with MessageList.
 *
 * Covers:
 * - SuggestionChips renders all chip labels.
 * - Tapping each chip invokes its onPress.
 * - MessageList renders chips under every non-empty guide bubble.
 * - MessageList does NOT render chips under user bubbles.
 * - MessageList does NOT render chips under the streaming-empty guide placeholder.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SuggestionChips } from '../components/SuggestionChips';
import { MessageList } from '../components/MessageList';
import type { Message } from '../types/chat';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
  getCalendars: jest.fn(() => []),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'text'>): Message {
  return {
    ...overrides,
  };
}

// ── SuggestionChips unit tests ────────────────────────────────────────────────

describe('SuggestionChips', () => {
  it('renders all supplied chip labels', () => {
    const chips = [
      { label: 'Tell me more', onPress: jest.fn() },
      { label: 'Walk me there', onPress: jest.fn() },
      { label: 'Food nearby', onPress: jest.fn() },
    ];
    const { getByText } = render(<SuggestionChips chips={chips} />);

    expect(getByText('Tell me more')).toBeTruthy();
    expect(getByText('Walk me there')).toBeTruthy();
    expect(getByText('Food nearby')).toBeTruthy();
  });

  it('assigns testID per chip label', () => {
    const chips = [
      { label: 'Tell me more', onPress: jest.fn() },
      { label: 'Walk me there', onPress: jest.fn() },
    ];
    const { getByTestId } = render(<SuggestionChips chips={chips} />);

    expect(getByTestId('suggestion-chip-Tell me more')).toBeTruthy();
    expect(getByTestId('suggestion-chip-Walk me there')).toBeTruthy();
  });

  it('calls onPress for the tapped chip', () => {
    const onPress1 = jest.fn();
    const onPress2 = jest.fn();
    const onPress3 = jest.fn();
    const chips = [
      { label: 'Tell me more', onPress: onPress1 },
      { label: 'Walk me there', onPress: onPress2 },
      { label: 'Food nearby', onPress: onPress3 },
    ];
    const { getByTestId } = render(<SuggestionChips chips={chips} />);

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    expect(onPress1).toHaveBeenCalledTimes(1);
    expect(onPress2).not.toHaveBeenCalled();
    expect(onPress3).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('suggestion-chip-Walk me there'));
    expect(onPress2).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('suggestion-chip-Food nearby'));
    expect(onPress3).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when chips array is empty', () => {
    const { toJSON } = render(<SuggestionChips chips={[]} />);
    expect(toJSON()).toBeNull();
  });
});

// ── MessageList integration tests ─────────────────────────────────────────────

describe('MessageList — suggestion chips integration', () => {
  const onSendChip = jest.fn();

  beforeEach(() => {
    onSendChip.mockClear();
  });

  it('renders chips beneath a non-empty guide bubble', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: 'Bryant Park has a lovely reading room.' }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    // All three default chips should appear.
    expect(getByTestId('suggestion-chip-Tell me more')).toBeTruthy();
    expect(getByTestId('suggestion-chip-Walk me there')).toBeTruthy();
    expect(getByTestId('suggestion-chip-Food nearby')).toBeTruthy();
  });

  it('renders chips beneath EVERY non-empty guide bubble, not just the latest', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: 'Bryant Park has a lovely reading room.' }),
      makeMessage({ id: '2', role: 'user', text: 'Tell me more about Bryant Park' }),
      makeMessage({ id: '3', role: 'guide', text: 'The reading room is free and quiet.' }),
    ];

    const { getAllByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    // Two guide bubbles => two sets of chips; each chip label appears twice.
    const tellMeMoreChips = getAllByTestId('suggestion-chip-Tell me more');
    expect(tellMeMoreChips.length).toBe(2);

    const walkChips = getAllByTestId('suggestion-chip-Walk me there');
    expect(walkChips.length).toBe(2);

    const foodChips = getAllByTestId('suggestion-chip-Food nearby');
    expect(foodChips.length).toBe(2);
  });

  it('does NOT render chips beneath a user bubble', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'What is near me?' }),
    ];

    const { queryByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    expect(queryByTestId('suggestion-chip-Tell me more')).toBeNull();
    expect(queryByTestId('suggestion-chip-Walk me there')).toBeNull();
    expect(queryByTestId('suggestion-chip-Food nearby')).toBeNull();
  });

  it('does NOT render chips beneath the streaming-empty guide placeholder (text is empty)', () => {
    // The streaming placeholder has role 'guide' but empty text while tokens are arriving.
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: '' }),
    ];

    const { queryByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    expect(queryByTestId('suggestion-chip-Tell me more')).toBeNull();
    expect(queryByTestId('suggestion-chip-Walk me there')).toBeNull();
    expect(queryByTestId('suggestion-chip-Food nearby')).toBeNull();
  });

  it('tapping Tell-me-more chip calls onSendChip with placeName when available', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        role: 'guide',
        text: 'Bryant Park is beautiful.',
        locationUsed: { latitude: 40.7, longitude: -74.0, accuracy: 5, placeName: 'Bryant Park' } as any,
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    expect(onSendChip).toHaveBeenCalledWith('Tell me more about Bryant Park');
  });

  it('tapping Walk-me-there chip calls onSendChip with placeName', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        role: 'guide',
        text: 'The carousel is nearby.',
        locationUsed: { latitude: 40.7, longitude: -74.0, accuracy: 5, placeName: 'Bryant Park' } as any,
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Walk me there'));
    expect(onSendChip).toHaveBeenCalledWith('Walk me to Bryant Park');
  });

  it('tapping Food-nearby chip always sends fixed food query', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: 'The area has many options.' }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Food nearby'));
    expect(onSendChip).toHaveBeenCalledWith('What food is good near here?');
  });

  it('falls back to first 8 words of text when no placeName', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        role: 'guide',
        text: 'One two three four five six seven eight nine ten.',
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    // 8-word cap: "One two three four five six seven eight"
    expect(onSendChip).toHaveBeenCalledWith(
      'Tell me more about One two three four five six seven eight'
    );
  });

  it('uses manual location string when locationUsed is a string', () => {
    const messages: Message[] = [
      makeMessage({
        id: '1',
        role: 'guide',
        text: 'There is a lot to see.',
        locationUsed: 'Times Square, NYC',
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    expect(onSendChip).toHaveBeenCalledWith('Tell me more about Times Square, NYC');
  });
});
