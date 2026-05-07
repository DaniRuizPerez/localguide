/**
 * Tests for the shared chatStore singleton: message mutations, subscriber
 * coalescing (no-op token writes don't fire), and clear().
 */

import { chatStore } from '../services/ChatStore';

describe('chatStore', () => {
  // Module-level singleton — wipe between tests.
  beforeEach(() => chatStore.clear());

  it('addUserMessage / addGuideMessage return ids and append to messages', () => {
    const uid = chatStore.addUserMessage('hi');
    const gid = chatStore.addGuideMessage('hello', 'Paris', 100, 'ai-online');
    const snap = chatStore.get();
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[0].id).toBe(uid);
    expect(snap.messages[0].role).toBe('user');
    expect(snap.messages[1].id).toBe(gid);
    expect(snap.messages[1].role).toBe('guide');
    expect(snap.messages[1].source).toBe('ai-online');
  });

  it('appendGuideToken updates the last message text', () => {
    const id = chatStore.addGuidePlaceholder('Paris');
    chatStore.appendGuideToken(id, 'Hel');
    chatStore.appendGuideToken(id, 'lo');
    expect(chatStore.get().messages[0].text).toBe('Hello');
  });

  it('appendGuideToken on a non-existent id is a no-op (does not notify)', () => {
    chatStore.addGuidePlaceholder('Paris');
    const fired: number[] = [];
    const unsub = chatStore.subscribe((s) => fired.push(s.messages.length));
    chatStore.appendGuideToken('nope', 'x');
    unsub();
    expect(fired).toEqual([]);
  });

  it('finalizeGuideMessage trims and records duration', () => {
    const id = chatStore.addGuidePlaceholder('Paris');
    chatStore.appendGuideToken(id, '  hello world  ');
    chatStore.finalizeGuideMessage(id, 250);
    const msg = chatStore.get().messages[0];
    expect(msg.text).toBe('hello world');
    expect(msg.durationMs).toBe(250);
  });

  it('subscribe fires for every successful token append', () => {
    const id = chatStore.addGuidePlaceholder('Paris');
    const fires: string[] = [];
    const unsub = chatStore.subscribe((s) => fires.push(s.messages[s.messages.length - 1]?.text ?? ''));
    chatStore.appendGuideToken(id, 'a');
    chatStore.appendGuideToken(id, 'b');
    chatStore.appendGuideToken(id, 'c');
    unsub();
    expect(fires).toEqual(['a', 'ab', 'abc']);
  });

  it('subscribe fires when inferring flips', () => {
    const seen: boolean[] = [];
    const unsub = chatStore.subscribe((s) => seen.push(s.inferring));
    chatStore.setInferring(true);
    chatStore.setInferring(true); // no-op — same value
    chatStore.setInferring(false);
    unsub();
    expect(seen).toEqual([true, false]);
  });

  it('setGuideError fills empty placeholders and leaves filled ones', () => {
    const idEmpty = chatStore.addGuidePlaceholder('Paris');
    const idFilled = chatStore.addGuidePlaceholder('Paris');
    chatStore.appendGuideToken(idFilled, 'partial response');
    chatStore.setGuideError(idEmpty, 'timeout');
    chatStore.setGuideError(idFilled, 'timeout');
    const msgs = chatStore.get().messages;
    expect(msgs[0].text).toContain('Sorry');
    expect(msgs[1].text).toBe('partial response');
  });

  it('clear resets everything and notifies once', () => {
    chatStore.addUserMessage('hi');
    chatStore.setInferring(true);
    const fires: number[] = [];
    const unsub = chatStore.subscribe((s) => fires.push(s.messages.length));
    chatStore.clear();
    unsub();
    expect(fires).toEqual([0]);
    const snap = chatStore.get();
    expect(snap.messages).toHaveLength(0);
    expect(snap.inferring).toBe(false);
  });

  it('unsubscribe stops further callbacks', () => {
    const fires: number[] = [];
    const unsub = chatStore.subscribe((s) => fires.push(s.messages.length));
    chatStore.addUserMessage('hi');
    unsub();
    chatStore.addUserMessage('again');
    expect(fires).toEqual([1]);
  });
});
