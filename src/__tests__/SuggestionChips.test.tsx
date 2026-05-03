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

  it('renders the Tell-me-more chip beneath a non-empty guide bubble', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: 'Bryant Park has a lovely reading room.' }),
    ];

    const { getByTestId, queryByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    expect(getByTestId('suggestion-chip-Tell me more')).toBeTruthy();
    // The previous Walk-me-there / Food-nearby chips were removed — they
    // drove off-topic follow-ups. Only Tell-me-more remains.
    expect(queryByTestId('suggestion-chip-Walk me there')).toBeNull();
    expect(queryByTestId('suggestion-chip-Food nearby')).toBeNull();
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

    const tellMeMoreChips = getAllByTestId('suggestion-chip-Tell me more');
    expect(tellMeMoreChips.length).toBe(2);
  });

  it('does NOT render chips beneath a user bubble', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'What is near me?' }),
    ];

    const { queryByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    expect(queryByTestId('suggestion-chip-Tell me more')).toBeNull();
  });

  it('does NOT render chips beneath the streaming-empty guide placeholder (text is empty)', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'guide', text: '' }),
    ];

    const { queryByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    expect(queryByTestId('suggestion-chip-Tell me more')).toBeNull();
  });

  it('Tell-me-more topic comes from the prior USER message, not the guide bubble placeName', () => {
    // User asked about Stanford while their GPS placeName was Palo Alto. The
    // chip must use "Stanford" — without this fix the topic was the bubble's
    // placeName and the follow-up came back about the wrong POI.
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'Tell me about Stanford' }),
      makeMessage({
        id: '2',
        role: 'guide',
        text: 'Stanford is a private research university.',
        locationUsed: { latitude: 37.44, longitude: -122.14, accuracy: 5, placeName: 'Palo Alto' } as any,
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    // NEW signature: onSendChip(displayText, promptText)
    const [displayText, promptText] = onSendChip.mock.calls[0];
    // Display text is short — just "Tell me more about Stanford", no instructions.
    expect(displayText).toBe('Tell me more about Stanford');
    expect(displayText).not.toMatch(/Palo Alto/);
    expect(displayText).not.toMatch(/do not repeat/i);
    // Prompt text carries the verbose instruction for the LLM.
    expect(promptText).toMatch(/^Tell me more about Stanford\b/);
    expect(promptText).not.toMatch(/Palo Alto/);
    expect(promptText).toMatch(/do not repeat/i);
    expect(promptText).toMatch(/long, detailed/i);
  });

  it('display text is short while prompt text is verbose (display/prompt split)', () => {
    // Core regression test for T1: the user bubble should show only the
    // short label; the LLM receives the full anti-repeat instruction.
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'Tell me about Bryant Park' }),
      makeMessage({ id: '2', role: 'guide', text: 'Bryant Park has a lovely reading room.' }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    const [displayText, promptText] = onSendChip.mock.calls[0];
    // Display text shown in the user bubble — short and clean.
    expect(displayText).toBe('Tell me more about Bryant Park');
    // Prompt text sent to the LLM — verbose with instructions.
    expect(promptText).toMatch(/^Tell me more about Bryant Park\./);
    expect(promptText).toMatch(/Give a long, detailed answer/);
    expect(promptText).toMatch(/Do NOT repeat/);
    expect(promptText).toMatch(/Add new material/);
    // Display must NOT contain the verbose instructions.
    expect(displayText).not.toMatch(/Give a long, detailed answer/);
    expect(displayText).not.toMatch(/Do NOT repeat/);
  });

  it('falls back to placeName when there is no prior user message', () => {
    // Auto-guide cue: a guide bubble with no preceding user message.
    const messages: Message[] = [
      makeMessage({
        id: '1',
        role: 'guide',
        text: 'Welcome to the area.',
        locationUsed: { latitude: 40.7, longitude: -74.0, accuracy: 5, placeName: 'Bryant Park' } as any,
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    // Both display and prompt should reference the placeName.
    const [displayText, promptText] = onSendChip.mock.calls[0];
    expect(displayText).toMatch(/^Tell me more about Bryant Park$/);
    expect(promptText).toMatch(/^Tell me more about Bryant Park\b/);
  });

  it('strips question prefixes from the prior user message ("What is X?" → "X")', () => {
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'What is the Hoover Institution?' }),
      makeMessage({ id: '2', role: 'guide', text: 'A public-policy think tank.' }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    const [displayText, promptText] = onSendChip.mock.calls[0];
    expect(displayText).toMatch(/^Tell me more about the Hoover Institution$/);
    expect(promptText).toMatch(/^Tell me more about the Hoover Institution\b/);
  });

  it('topic resolution is pulled from the prior user message (not guide bubble text)', () => {
    // Regression: topic must still be derived from the prior *user* message,
    // not from the guide bubble's own text or GPS placeName.
    const messages: Message[] = [
      makeMessage({ id: '1', role: 'user', text: 'Tell me about The Met' }),
      makeMessage({
        id: '2',
        role: 'guide',
        text: 'The Metropolitan Museum of Art is located on Fifth Avenue.',
        locationUsed: { latitude: 40.779, longitude: -73.963, accuracy: 10, placeName: 'Upper East Side' } as any,
      }),
    ];

    const { getByTestId } = render(
      <MessageList messages={messages} autoGuideEnabled={false} onSendChip={onSendChip} />
    );

    fireEvent.press(getByTestId('suggestion-chip-Tell me more'));
    const [displayText] = onSendChip.mock.calls[0];
    // Should resolve to "The Met" from the user message, not the GPS placeName.
    expect(displayText).toBe('Tell me more about The Met');
    expect(displayText).not.toMatch(/Upper East Side/);
  });
});
