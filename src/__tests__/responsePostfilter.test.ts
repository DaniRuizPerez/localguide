/**
 * Tests for StreamPostfilter — repetition / flood / token-leak / format
 * detectors and finalize() trim behaviour. Each test feeds chars one at a
 * time so we exercise the streaming codepath, not just whole-string match.
 */

import { StreamPostfilter, trailerFor } from '../services/responsePostfilter';

function feed(pf: StreamPostfilter, s: string): { reason: string; at: number } {
  for (let i = 0; i < s.length; i += 1) {
    const r = pf.pushDelta(s[i]);
    if (r !== 'ok') return { reason: r, at: i + 1 };
  }
  return { reason: 'ok', at: s.length };
}

describe('StreamPostfilter — periodic repetition', () => {
  it('aborts on a sentence-level loop', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'Stanford is beautiful. '.repeat(8));
    expect(out.reason).toBe('abort_repetition');
    // cleanedText strips one full repeat block — should be a clean prefix.
    expect(pf.getCleanedText()).toMatch(/^Stanford is beautiful\.( Stanford is beautiful\.)*$/);
  });

  it("aborts on a 'thinking' loop", () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'Hmm let me think. '.repeat(8));
    expect(out.reason).toBe('abort_repetition');
  });

  it('aborts on a bigram cycle', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'I see X. I see Y. '.repeat(10));
    expect(out.reason).toBe('abort_repetition');
  });

  it('does NOT abort on legitimate light repetition', () => {
    const cases = [
      'very very good answer to your question',
      'yes yes yes that is right and i agree',
      "knock knock who's there it's a joke setup",
    ];
    for (const c of cases) {
      const pf = new StreamPostfilter();
      const out = feed(pf, c);
      expect(out.reason).toBe('ok');
    }
  });

  it('does NOT abort on a normal long chat answer', () => {
    const pf = new StreamPostfilter();
    const text =
      'Stanford Memorial Church is the centrepiece of the campus, built in 1903 ' +
      'in honour of Leland Stanford by his wife Jane. Its mosaic façade and ' +
      'organ pipes are among the most photographed features at the university. ' +
      'Services are still held there weekly, and visitors can usually walk in ' +
      'during the day to admire the interior.';
    const out = feed(pf, text);
    expect(out.reason).toBe('ok');
  });
});

describe('StreamPostfilter — flood', () => {
  it('aborts on a long single-char run', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'Sure! ' + 'x'.repeat(60));
    expect(out.reason).toBe('abort_flood');
    expect(pf.getCleanedText()).toBe('Sure!');
  });

  it('does NOT trip on legitimate ellipses (sentence-terminator carve-out)', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'wait...let me think...about that...one more time...');
    expect(out.reason).toBe('ok');
  });
});

describe('StreamPostfilter — special-token leakage', () => {
  it('aborts when an EOS token leaks', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'Stanford is great <|endoftext|> hi');
    expect(out.reason).toBe('abort_token');
    expect(pf.getCleanedText()).toBe('Stanford is great');
  });

  it('aborts on <end_of_turn>', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, 'short answer<end_of_turn>');
    expect(out.reason).toBe('abort_token');
    expect(pf.getCleanedText()).toBe('short answer');
  });
});

describe('StreamPostfilter — format spew', () => {
  it('aborts when a chat answer opens with raw JSON', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, '{"answer": "the quick brown fox"');
    expect(out.reason).toBe('abort_format');
    expect(pf.getCleanedText()).toBe('');
  });

  it('aborts when a chat answer opens with a code fence', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf, '```json\n{ ');
    expect(out.reason).toBe('abort_format');
  });

  it('does NOT abort when JSON-like syntax appears mid-answer', () => {
    const pf = new StreamPostfilter();
    const out = feed(pf,
      'Sure! In short, the config looks like this: { x: 1, y: 2 } — let me know if that helps.');
    expect(out.reason).toBe('ok');
  });
});

describe('StreamPostfilter — finalize() trim-only behaviour', () => {
  it('trims a single trailing duplicate sentence on natural finish', () => {
    const pf = new StreamPostfilter();
    const text =
      'The Memorial Church sits at the head of the Stanford Quad and is open to ' +
      'visitors most weekday afternoons. ' +
      'The Memorial Church sits at the head of the Stanford Quad and is open to ' +
      'visitors most weekday afternoons. ';
    feed(pf, text);
    const result = pf.finalize();
    expect(result.trimmedReason).toBe('abort_repetition');
    expect(result.cleanedText).toMatch(/Stanford Quad and is open to visitors most weekday afternoons\.$/);
    // Should be ~half the length.
    expect(result.cleanedText.length).toBeLessThan(text.length * 0.6);
  });

  it('returns the input unchanged when no trailing repetition is present', () => {
    const pf = new StreamPostfilter();
    const text = 'A reasonable answer with no duplication at the end.';
    feed(pf, text);
    const result = pf.finalize();
    expect(result.trimmedReason).toBeNull();
    expect(result.cleanedText).toBe(text);
  });

  it('returns empty cleanedText for an empty stream', () => {
    const pf = new StreamPostfilter();
    const result = pf.finalize();
    expect(result.cleanedText).toBe('');
    expect(result.trimmedReason).toBeNull();
  });

  it('forwards an earlier mid-stream abort through finalize()', () => {
    const pf = new StreamPostfilter();
    feed(pf, 'Great views — '.repeat(6));
    const result = pf.finalize();
    expect(result.trimmedReason).toBe('abort_repetition');
  });
});

describe('StreamPostfilter — kill switch', () => {
  it('returns ok regardless of input when disabled', () => {
    const pf = new StreamPostfilter({ enabled: false });
    const out = feed(pf, 'loop loop loop loop loop loop loop loop loop loop ');
    expect(out.reason).toBe('ok');
  });
});

describe('StreamPostfilter — race semantics', () => {
  it('keeps returning the abort reason on every subsequent pushDelta', () => {
    const pf = new StreamPostfilter();
    feed(pf, 'AB AB AB AB AB AB AB AB AB AB ');
    expect(pf.pushDelta('more text')).toBe('abort_repetition');
    expect(pf.pushDelta('and more')).toBe('abort_repetition');
  });
});

describe('trailerFor', () => {
  it('returns user-readable strings for the user-facing reasons', () => {
    expect(trailerFor('abort_repetition')).toMatch(/repeating/);
    expect(trailerFor('abort_flood')).toMatch(/breaking up/);
    expect(trailerFor('abort_format')).toMatch(/try again/);
  });

  it('returns empty for silent reasons', () => {
    expect(trailerFor('abort_token')).toBe('');
    expect(trailerFor('ok')).toBe('');
  });
});
