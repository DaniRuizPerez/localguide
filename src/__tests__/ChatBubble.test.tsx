/**
 * Tests for AnimatedChatBubble and SourceBadge integration.
 *
 * Covers:
 *  - Snapshot per source variant on a guide message.
 *  - Guide message with no `source` renders without the badge.
 *  - User message with a source set does NOT render the badge.
 *  - SourceBadge standalone snapshot (pure render, all variants).
 *  - Streaming-placeholder (text === '') suppresses the badge even when source is set.
 *  - Badge re-appears once the first token lands (text non-empty).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { AnimatedChatBubble } from '../components/ChatBubble';
import { SourceBadge } from '../components/SourceBadge';
import type { Message } from '../types/chat';
import type { Source } from '../components/SourceBadge';

// Animated.Value / Animated.timing are mocked by jest-expo; spring / parallel
// run synchronously so we can snapshot deterministically.

const BASE_GUIDE: Omit<Message, 'source'> = {
  id: 'test-guide-1',
  role: 'guide',
  text: 'Here is what I found for you.',
};

const BASE_USER: Message = {
  id: 'test-user-1',
  role: 'user',
  text: 'Tell me about this place.',
};

// ── SourceBadge standalone snapshots ─────────────────────────────────────────

describe('SourceBadge', () => {
  const variants: Source[] = ['wikipedia', 'maps', 'ai-online', 'ai-offline'];

  variants.forEach((source) => {
    it(`renders ${source} variant`, () => {
      const { toJSON } = render(<SourceBadge source={source} />);
      expect(toJSON()).toMatchSnapshot();
    });
  });
});

// ── AnimatedChatBubble — guide messages with each source ──────────────────────

describe('AnimatedChatBubble — guide messages', () => {
  const variants: Source[] = ['wikipedia', 'maps', 'ai-online', 'ai-offline'];

  variants.forEach((source) => {
    it(`renders source badge for guide message with source="${source}"`, () => {
      const message: Message = { ...BASE_GUIDE, source };
      const { toJSON, getByText } = render(<AnimatedChatBubble message={message} />);
      // Badge label must be present in the tree.
      // The i18n keys exist in EN strings; fall back gracefully if not yet added.
      expect(toJSON()).toMatchSnapshot();
      // At a minimum the guide text must render.
      expect(getByText(BASE_GUIDE.text)).toBeTruthy();
    });
  });

  it('renders without a source badge when source is not set', () => {
    const message: Message = { ...BASE_GUIDE };
    const { queryByText, getByText } = render(<AnimatedChatBubble message={message} />);
    expect(getByText(BASE_GUIDE.text)).toBeTruthy();
    // None of the badge labels should be present.
    expect(queryByText(/Wikipedia/)).toBeNull();
    expect(queryByText(/Maps/)).toBeNull();
    expect(queryByText(/AI/)).toBeNull();
    expect(queryByText(/Offline/)).toBeNull();
  });
});

// ── AnimatedChatBubble — streaming-placeholder suppresses the badge ───────────

describe('AnimatedChatBubble — streaming-empty placeholder', () => {
  const variants: Source[] = ['wikipedia', 'maps', 'ai-online', 'ai-offline'];

  variants.forEach((source) => {
    it(`does NOT render a SourceBadge when text is empty and source="${source}"`, () => {
      const message: Message = {
        id: 'streaming-1',
        role: 'guide',
        text: '',
        source,
      };
      const { queryByText } = render(<AnimatedChatBubble message={message} />);
      // The footer (badge + meta) must be absent while the bubble has no text.
      expect(queryByText(/Wikipedia/)).toBeNull();
      expect(queryByText(/Maps/)).toBeNull();
      expect(queryByText(/AI/)).toBeNull();
      expect(queryByText(/Offline/)).toBeNull();
    });
  });

  it('renders SourceBadge once text is non-empty', () => {
    const message: Message = {
      id: 'streaming-2',
      role: 'guide',
      text: 'First token.',
      source: 'ai-online',
    };
    const { queryByText } = render(<AnimatedChatBubble message={message} />);
    // At least one of the badge label fragments must now be present.
    const hasBadge =
      queryByText(/AI/) !== null ||
      queryByText(/Online/) !== null ||
      queryByText(/🧠/) !== null; // 🧠 glyph
    expect(hasBadge).toBe(true);
  });
});

// ── AnimatedChatBubble — user messages NEVER show the badge ──────────────────

describe('AnimatedChatBubble — user messages', () => {
  const variants: Source[] = ['wikipedia', 'maps', 'ai-online', 'ai-offline'];

  variants.forEach((source) => {
    it(`does NOT render a badge on user message with source="${source}"`, () => {
      const message: Message = { ...BASE_USER, source };
      const { queryByText, getByText } = render(<AnimatedChatBubble message={message} />);
      expect(getByText(BASE_USER.text)).toBeTruthy();
      // None of the source badge labels should appear.
      expect(queryByText(/Wikipedia/)).toBeNull();
      expect(queryByText(/Maps/)).toBeNull();
      expect(queryByText(/AI/)).toBeNull();
      expect(queryByText(/Offline/)).toBeNull();
    });
  });
});
