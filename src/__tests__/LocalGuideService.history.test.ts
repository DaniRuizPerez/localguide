/**
 * Tests for the cross-turn chat memory plumbing. askStream and
 * askWithImageStream accept an optional `history` array; the prompt builder
 * has to render those prior turns inline so the model can refer back when
 * the user taps a second POI without starting a new chat session.
 */

const mockRunStream = jest.fn();

jest.mock('../services/InferenceService', () => {
  const actual = jest.requireActual('../services/InferenceService');
  class Patched extends actual.InferenceService {
    async runInferenceStream(prompt: string, callbacks: any, options: any) {
      mockRunStream(prompt, options);
      // Resolve immediately so the test doesn't hang waiting for a stream.
      callbacks.onDone();
      return { abort: jest.fn().mockResolvedValue(undefined) };
    }
  }
  return {
    ...actual,
    InferenceService: Patched,
    inferenceService: new Patched(),
  };
});

import { localGuideService, type ChatTurn } from '../services/LocalGuideService';

const paris = { latitude: 48.8566, longitude: 2.3522, placeName: 'Paris' };

describe('askStream — chat history', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('omits the history block when no history is passed', async () => {
    await localGuideService.askStream('Tell me about the Eiffel Tower.', paris, {
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });
    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).not.toContain('Previous conversation');
    expect(prompt).toContain('Cue: Tell me about the Eiffel Tower.');
  });

  it('renders prior turns labeled Visitor / Guide above the new cue', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'Tell me about the Eiffel Tower.' },
      { role: 'guide', text: 'The Eiffel Tower was built for the 1889 World\'s Fair…' },
    ];
    await localGuideService.askStream(
      'Tell me about the Louvre.',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Previous conversation in this session:');
    expect(prompt).toContain('Visitor: Tell me about the Eiffel Tower.');
    expect(prompt).toContain('Guide: The Eiffel Tower was built for the 1889 World\'s Fair');
    expect(prompt).toContain('Cue: Tell me about the Louvre.');

    // Order: history must come BEFORE the new cue.
    const historyIdx = prompt.indexOf('Previous conversation');
    const cueIdx = prompt.indexOf('Cue: Tell me about the Louvre.');
    expect(historyIdx).toBeGreaterThan(-1);
    expect(cueIdx).toBeGreaterThan(historyIdx);
  });

  it('keeps only the last four turns to bound prompt size on Pixel 3', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'OLDEST_USER' },
      { role: 'guide', text: 'OLDEST_GUIDE' },
      { role: 'user', text: 'OLD_USER' },
      { role: 'guide', text: 'OLD_GUIDE' },
      { role: 'user', text: 'RECENT_USER' },
      { role: 'guide', text: 'RECENT_GUIDE' },
    ];
    await localGuideService.askStream(
      'next?',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).not.toContain('OLDEST_USER');
    expect(prompt).not.toContain('OLDEST_GUIDE');
    expect(prompt).toContain('OLD_USER');
    expect(prompt).toContain('OLD_GUIDE');
    expect(prompt).toContain('RECENT_USER');
    expect(prompt).toContain('RECENT_GUIDE');
  });

  it('clips overlong turns with an ellipsis so one runaway response can\'t blow the prompt budget', async () => {
    const longText = 'X'.repeat(500);
    const history: ChatTurn[] = [
      { role: 'guide', text: longText },
    ];
    await localGuideService.askStream(
      'next?',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history
    );

    const prompt = mockRunStream.mock.calls[0][0];
    // Cap is 280 chars per turn. The full 500-char block must not appear.
    expect(prompt).not.toContain('X'.repeat(500));
    expect(prompt).toContain('…');
  });

  it('skips empty turns so an aborted stream\'s blank guide bubble is not included', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'real question' },
      { role: 'guide', text: '   ' },
      { role: 'user', text: '' },
    ];
    await localGuideService.askStream(
      'next?',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Visitor: real question');
    // Should not produce empty Visitor:/Guide: lines.
    expect(prompt).not.toMatch(/Visitor:\s*\n/);
    expect(prompt).not.toMatch(/Guide:\s*\n/);
  });
});
