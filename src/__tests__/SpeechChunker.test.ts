import { SpeechChunker } from '../services/SpeechChunker';

describe('SpeechChunker', () => {
  let segments: string[];
  let chunker: SpeechChunker;

  beforeEach(() => {
    segments = [];
  });

  describe('first-segment minimum length', () => {
    it('does not emit until minFirstChars is reached', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 40 });
      chunker.push('Short. ');
      expect(segments).toEqual([]);
    });

    it('emits once minFirstChars is reached and a sentence ends', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 20 });
      chunker.push('The first sentence is this long. ');
      expect(segments).toEqual(['The first sentence is this long.']);
    });

    it('applies minFirstChars only to the first segment', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 20 });
      chunker.push('The first sentence is this long. ');
      chunker.push('Hi. '); // short, but no longer the first
      expect(segments).toEqual(['The first sentence is this long.', 'Hi.']);
    });
  });

  describe('sentence-boundary detection', () => {
    beforeEach(() => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 1 });
    });

    it('splits on a period followed by a space', () => {
      chunker.push('First sentence. Second');
      expect(segments).toEqual(['First sentence.']);
    });

    it('splits on ! and ?', () => {
      chunker.push('Wow! Really? More');
      expect(segments).toEqual(['Wow!', 'Really?']);
    });

    it('splits on newline followed by whitespace', () => {
      chunker.push('Line one\n Line two');
      expect(segments).toEqual(['Line one']);
    });

    it('does not split on period not followed by whitespace (e.g. decimals)', () => {
      chunker.push('Temperature is 98.6 degrees.');
      // Only trailing period has no next-char yet — wait.
      expect(segments).toEqual([]);
      chunker.push(' ');
      expect(segments).toEqual(['Temperature is 98.6 degrees.']);
    });

    it('waits for confirmation when boundary is at the end of buffer', () => {
      chunker.push('First sentence.');
      expect(segments).toEqual([]);
      chunker.push(' ');
      expect(segments).toEqual(['First sentence.']);
    });

    it('emits multiple sentences pushed together', () => {
      chunker.push('Alpha. Beta. Gamma. ');
      expect(segments).toEqual(['Alpha.', 'Beta.', 'Gamma.']);
    });
  });

  describe('soft cut on long runs without punctuation', () => {
    it('cuts at whitespace when buffer exceeds softMaxChars', () => {
      chunker = new SpeechChunker((s) => segments.push(s), {
        minFirstChars: 1,
        softMaxChars: 20,
      });
      chunker.push('one two three four five six seven eight nine ten');
      expect(segments.length).toBeGreaterThan(0);
      for (const seg of segments) {
        expect(seg.length).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('flush()', () => {
    it('emits any remaining buffered text', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 1 });
      chunker.push('No terminator yet');
      expect(segments).toEqual([]);
      chunker.flush();
      expect(segments).toEqual(['No terminator yet']);
    });

    it('does not emit anything when buffer is empty or whitespace-only', () => {
      chunker = new SpeechChunker((s) => segments.push(s));
      chunker.push('   \n\t  ');
      chunker.flush();
      expect(segments).toEqual([]);
    });

    it('clears the buffer after flushing', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 1 });
      chunker.push('Partial');
      chunker.flush();
      chunker.flush(); // second flush should be a no-op
      expect(segments).toEqual(['Partial']);
    });
  });

  describe('stream-simulation', () => {
    it('handles one-token-at-a-time delivery like a real LLM stream', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 15 });
      const text = "Welcome to Paris. You're near the Seine. Enjoy!";
      for (const ch of text) {
        chunker.push(ch);
      }
      chunker.flush();
      expect(segments).toEqual([
        'Welcome to Paris.',
        "You're near the Seine.",
        'Enjoy!',
      ]);
    });

    it('ignores empty deltas', () => {
      chunker = new SpeechChunker((s) => segments.push(s), { minFirstChars: 1 });
      chunker.push('');
      chunker.push('Hello. ');
      expect(segments).toEqual(['Hello.']);
    });
  });
});