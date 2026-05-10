/**
 * Tests for the shared chatStore singleton: message mutations, subscriber
 * coalescing (no-op token writes don't fire), clear(), and AsyncStorage
 * persistence (hydration, debounced write, 200-message cap).
 */

import { chatStore } from '../services/ChatStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage is mocked globally via jest.setup.js.
// Cast to jest.Mocked to access .mock properties conveniently.
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('chatStore', () => {
  // Module-level singleton — wipe between tests.
  beforeEach(() => {
    chatStore.clear();
    jest.clearAllMocks();
    // Clear the AsyncStorage mock's internal storage too.
    (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
  });

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

  it('addUserMessage opts: persists subjectPoi when set; omits the field when not passed', () => {
    chatStore.addUserMessage('Tell me about Hoover Tower', { subjectPoi: 'Hoover Tower' });
    chatStore.addUserMessage('plain typed message');
    chatStore.addUserMessage('Tell me about this area', { subjectPoi: null });
    const msgs = chatStore.get().messages;
    expect(msgs[0].subjectPoi).toBe('Hoover Tower');
    // Default (omitted opts) → field absent (so inheritance walk keeps walking).
    expect(msgs[1]).not.toHaveProperty('subjectPoi');
    // Explicit null → preserved as a hard reset signal.
    expect(msgs[2].subjectPoi).toBeNull();
  });

  it('addUserMessage opts: imageUri positional arg removed — opts.imageUri replaces it', () => {
    chatStore.addUserMessage('photo', { imageUri: 'file:///photo.jpg' });
    expect(chatStore.get().messages[0].imageUri).toBe('file:///photo.jpg');
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

  it('replaceGuideText overwrites the bubble body in one shot', () => {
    const id = chatStore.addGuidePlaceholder('Paris');
    chatStore.appendGuideToken(id, 'loop loop loop ');
    chatStore.replaceGuideText(id, 'cleaned\n\n_(stopped — got stuck repeating)_');
    expect(chatStore.get().messages[0].text).toBe('cleaned\n\n_(stopped — got stuck repeating)_');
  });

  it('replaceGuideText on a non-existent id is a no-op', () => {
    chatStore.addGuidePlaceholder('Paris');
    const fired: number[] = [];
    const unsub = chatStore.subscribe((s) => fired.push(s.messages.length));
    chatStore.replaceGuideText('nope', 'x');
    unsub();
    expect(fired).toEqual([]);
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

// ── AsyncStorage persistence ──────────────────────────────────────────────

describe('chatStore — AsyncStorage persistence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    chatStore.clear();
    jest.clearAllMocks();
    (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounced write: push a message, advance 500 ms → setItem called with new array', async () => {
    chatStore.addUserMessage('hello persist');
    // Timer not yet fired.
    expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();

    // Advance past debounce window.
    jest.advanceTimersByTime(500);
    // Let the async setItem call flush.
    await Promise.resolve();

    expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
    expect(key).toBe('chat-messages-v1');
    const parsed = JSON.parse(value as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((m: any) => m.text === 'hello persist')).toBe(true);
  });

  it('multiple rapid mutations coalesce into a single write', async () => {
    chatStore.addUserMessage('msg1');
    chatStore.addUserMessage('msg2');
    chatStore.addUserMessage('msg3');

    jest.advanceTimersByTime(500);
    await Promise.resolve();

    // Only one setItem despite three mutations.
    expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((mockAsyncStorage.setItem.mock.calls[0][1]) as string);
    expect(parsed).toHaveLength(3);
  });

  it('cap at 200: push 250 messages → stored array length ≤ 200, oldest dropped', async () => {
    for (let i = 0; i < 250; i++) {
      chatStore.addUserMessage(`msg-${i}`);
    }

    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(mockAsyncStorage.setItem).toHaveBeenCalled();
    const parsed = JSON.parse(
      (mockAsyncStorage.setItem.mock.calls[mockAsyncStorage.setItem.mock.calls.length - 1][1]) as string
    );
    expect(parsed.length).toBeLessThanOrEqual(200);
    // Oldest messages (msg-0 … msg-49) should be gone; newest kept.
    expect(parsed.some((m: any) => m.text === 'msg-0')).toBe(false);
    expect(parsed.some((m: any) => m.text === 'msg-249')).toBe(true);
  });

  it('clear writes empty array to AsyncStorage', async () => {
    chatStore.addUserMessage('to be cleared');
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    jest.clearAllMocks();

    chatStore.clear();
    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((mockAsyncStorage.setItem.mock.calls[0][1]) as string);
    expect(parsed).toEqual([]);
  });
});

// ── Hydration on module import ────────────────────────────────────────────

describe('chatStore — hydration on import', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads persisted messages from AsyncStorage when the module is imported fresh', async () => {
    const storedMessages = [
      { id: 'old-1', role: 'user', text: 'hydrated message' },
      { id: 'old-2', role: 'guide', text: 'hydrated reply', locationUsed: 'Paris' },
    ];

    // Prime the mock storage before the module loads.
    (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {
      'chat-messages-v1': JSON.stringify(storedMessages),
    };

    let freshStore: typeof chatStore | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      freshStore = require('../services/ChatStore').chatStore;
    });

    // Give the async hydration IIFE time to complete.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msgs = freshStore!.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe('hydrated message');
    expect(msgs[1].text).toBe('hydrated reply');
  });

  it('skips hydration if messages already exist (mutation won the race)', async () => {
    const storedMessages = [
      { id: 'stale-1', role: 'user', text: 'stale from storage' },
    ];

    (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {
      'chat-messages-v1': JSON.stringify(storedMessages),
    };

    let freshStore: typeof chatStore | undefined;
    jest.isolateModules(() => {
      freshStore = require('../services/ChatStore').chatStore;
      // Immediately push a message — fires before the async getItem resolves.
      freshStore!.addUserMessage('in-memory wins');
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const msgs = freshStore!.getMessages();
    // The in-memory mutation is still present; stale storage did not overwrite.
    expect(msgs.some((m) => m.text === 'in-memory wins')).toBe(true);
    expect(msgs.some((m) => m.text === 'stale from storage')).toBe(false);
  });

  it('starts with empty messages if AsyncStorage returns malformed JSON', async () => {
    (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {
      'chat-messages-v1': 'not-valid-json{{{',
    };

    let freshStore: typeof chatStore | undefined;
    jest.isolateModules(() => {
      freshStore = require('../services/ChatStore').chatStore;
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(freshStore!.getMessages()).toHaveLength(0);
  });
});
