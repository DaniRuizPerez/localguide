/**
 * Unit tests for the source-badge plumbing in useChatMessages.
 *
 * Covers addGuidePlaceholder with a source, setGuideSource (happy path +
 * non-existent-id no-op), and addGuideMessage with a source.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useChatMessages } from '../hooks/useChatMessages';

describe('useChatMessages — source field', () => {
  it('addGuidePlaceholder with source stores the source on the message', () => {
    const { result } = renderHook(() => useChatMessages());

    let id = '';
    act(() => {
      id = result.current.addGuidePlaceholder('Paris', 'ai-online');
    });

    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg).toBeDefined();
    expect(msg!.source).toBe('ai-online');
  });

  it('addGuidePlaceholder without source leaves source undefined', () => {
    const { result } = renderHook(() => useChatMessages());

    let id = '';
    act(() => {
      id = result.current.addGuidePlaceholder('Paris');
    });

    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg!.source).toBeUndefined();
  });

  it('addGuideMessage with source stores the source on the message', () => {
    const { result } = renderHook(() => useChatMessages());

    let id = '';
    act(() => {
      id = result.current.addGuideMessage('Hello', 'Paris', undefined, 'maps');
    });

    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg!.source).toBe('maps');
  });

  it('setGuideSource mutates only the targeted message source', () => {
    const { result } = renderHook(() => useChatMessages());

    let id1 = '';
    let id2 = '';
    act(() => {
      id1 = result.current.addGuidePlaceholder('Paris', 'ai-online');
      id2 = result.current.addGuidePlaceholder('Rome', 'ai-online');
    });

    act(() => {
      result.current.setGuideSource(id1, 'wikipedia');
    });

    const msg1 = result.current.messages.find((m) => m.id === id1);
    const msg2 = result.current.messages.find((m) => m.id === id2);
    expect(msg1!.source).toBe('wikipedia');
    // id2 must not be touched
    expect(msg2!.source).toBe('ai-online');
  });

  it('setGuideSource on a non-existent id is a no-op', () => {
    const { result } = renderHook(() => useChatMessages());

    let id = '';
    act(() => {
      id = result.current.addGuidePlaceholder('Paris', 'ai-online');
    });

    // Should not throw, and the existing message is unaffected.
    act(() => {
      result.current.setGuideSource('does-not-exist', 'wikipedia');
    });

    const msg = result.current.messages.find((m) => m.id === id);
    expect(msg!.source).toBe('ai-online');
  });
});
