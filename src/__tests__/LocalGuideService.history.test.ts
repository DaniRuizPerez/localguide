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

describe('askStream — subject override + history guard', () => {
  beforeEach(() => {
    mockRunStream.mockClear();
  });

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('emits a Subject directive and uses the override as Place when subjectOverride is set', async () => {
    await localGuideService.askStream(
      'tell me its history',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      [],
      undefined,
      'Hoover Tower',
      'Hoover Tower'
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Subject: Hoover Tower.');
    // Subject is asserted twice for decoder anchoring.
    expect(prompt.match(/Hoover Tower/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(prompt).toContain('Place: Hoover Tower');
    // GPS placeName ("Paris") must NOT be the Place line when subject is set.
    expect(prompt).not.toMatch(/Place: Paris/);
  });

  it('preserves history when the subject is unchanged across turns', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'Tell me about Hoover Tower.' },
      { role: 'guide', text: 'Hoover Tower opened in 1941…' },
    ];
    await localGuideService.askStream(
      'tell me its history',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history,
      undefined,
      'Hoover Tower',
      'Hoover Tower'
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).toContain('Previous conversation in this session:');
    expect(prompt).toContain('Visitor: Tell me about Hoover Tower.');
  });

  it('drops history when the subject just changed (preserves the original guard)', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'Tell me about Mountain View.' },
      { role: 'guide', text: 'Mountain View is a city in Santa Clara County…' },
    ];
    await localGuideService.askStream(
      'Tell me about Hoover Tower.',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history,
      undefined,
      'Hoover Tower',
      'Mountain View'
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).not.toContain('Previous conversation');
    expect(prompt).not.toContain('Mountain View');
  });

  it('treats "Stanford" and "Stanford, California" as the same subject (sameSubject normalization)', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'Tell me about Stanford, California.' },
      { role: 'guide', text: 'Stanford was founded in 1885…' },
    ];
    await localGuideService.askStream(
      'tell me more',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history,
      undefined,
      'Stanford',
      'Stanford, California'
    );

    const prompt = mockRunStream.mock.calls[0][0];
    // History must be kept (subject is "the same" after region-suffix strip).
    expect(prompt).toContain('Previous conversation in this session:');
    expect(prompt).toContain('Stanford was founded');
  });

  it('omits the Subject directive entirely when subjectOverride is null (explicit reset)', async () => {
    const history: ChatTurn[] = [
      { role: 'user', text: 'Tell me about Hoover Tower.' },
      { role: 'guide', text: 'Hoover Tower opened in 1941…' },
    ];
    await localGuideService.askStream(
      'Tell me about this area',
      paris,
      { onToken: () => {}, onDone: () => {}, onError: () => {} },
      undefined,
      history,
      undefined,
      null,
      'Hoover Tower'
    );

    const prompt = mockRunStream.mock.calls[0][0];
    expect(prompt).not.toContain('Subject: ');
    // Reset means Place falls back to GPS placeName, not the prior subject.
    expect(prompt).toContain('Place: Paris');
    expect(prompt).not.toContain('Place: Hoover Tower');
  });
});
