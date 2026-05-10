/**
 * Tests for StreamPostfilter — repetition / flood / token-leak / format
 * detectors and finalize() trim behaviour. Each test feeds chars one at a
 * time so we exercise the streaming codepath, not just whole-string match.
 */

import * as fs from 'fs';
import * as path from 'path';
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
    // Period < 64 chars so the mid-stream path still requires 3 matches;
    // finalize() applies the 2-match trim and catches it after natural end.
    const sentence = 'Stanford Quad is open weekday afternoons. ';
    const text = sentence + sentence;
    feed(pf, text);
    const result = pf.finalize();
    expect(result.trimmedReason).toBe('abort_repetition');
    expect(result.cleanedText).toMatch(/Stanford Quad is open weekday afternoons\.$/);
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

describe('StreamPostfilter — getCleanedText preserves pre-tail content (issue #8)', () => {
  // Non-repeating string of unique comma-separated integers (>512 chars, no flood, no repetition).
  const uniquePrefix = Array.from({ length: 200 }, (_, i) => i).join(',') + ','; // ~691 chars

  it('returns the full leading content when caller passes the accumulated text', () => {
    const pf = new StreamPostfilter();
    // Block ≥ 64 chars so only 2 matches trigger abort.
    const block = 'The historic Stanford Quad gathers students from all over the world here. '; // 73 chars
    expect(uniquePrefix.length).toBeGreaterThan(512);
    const input = uniquePrefix + block.repeat(4);

    let accumulated = '';
    let abortedAt = -1;
    for (let i = 0; i < input.length; i++) {
      accumulated += input[i];
      if (pf.pushDelta(input[i]) !== 'ok') {
        abortedAt = i;
        break;
      }
    }

    expect(abortedAt).toBeGreaterThan(-1); // must have aborted on the repetition loop

    // Passing the full accumulated text preserves the leading content outside the tail window.
    const cleaned = pf.getCleanedText(accumulated);
    expect(cleaned.startsWith(uniquePrefix)).toBe(true);
    expect(cleaned).not.toContain(block.trimEnd());
  });

  it('finalize() with fullText preserves pre-tail content on natural finish', () => {
    const pf = new StreamPostfilter();
    // Trailing duplicate sentence — period < 64 so stream needs 3 matches but finalize uses 2.
    const sentence = 'Visit the Quad on a sunny afternoon. '; // 37 chars
    const text = uniquePrefix + sentence + sentence;

    for (const ch of text) pf.pushDelta(ch);

    // Stream did NOT abort (only 2 duplicate sentences, period < 64 needs 3 mid-stream).
    // finalize() applies 2-match threshold and detects the trailing repeat.
    const { cleanedText, trimmedReason } = pf.finalize(text);
    expect(trimmedReason).toBe('abort_repetition');
    expect(cleanedText.startsWith(uniquePrefix)).toBe(true);
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

describe('long-period sentence loop (Kee House regression)', () => {
  const fixture = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'loop_kee_house.txt'),
    'utf8',
  );

  it('aborts the captured Kee House loop with default settings', () => {
    const filter = new StreamPostfilter();
    let aborted: string | null = null;
    let abortedAt = -1;
    for (let i = 0; i < fixture.length; i++) {
      const reason = filter.pushDelta(fixture[i]);
      if (reason !== 'ok') {
        aborted = reason;
        abortedAt = i;
        break;
      }
    }
    expect(aborted).toBe('abort_repetition');
    // Should fire well before the end of the fixture (~1.2 kB); detection fires
    // around char 709 (2 × 182-char period within the 512-char tail window).
    expect(abortedAt).toBeLessThan(750);
    // Cleaned text should not be empty (we strip the partial trailing block, not everything).
    expect(filter.getCleanedText().length).toBeGreaterThan(50);
  });

  it('would NOT abort with the buggy tailCap=256 — proves the fix is what unblocks it', () => {
    const filter = new StreamPostfilter({ tailCap: 256 });
    let aborted: string | null = null;
    for (let i = 0; i < fixture.length; i++) {
      const reason = filter.pushDelta(fixture[i]);
      if (reason !== 'ok') { aborted = reason; break; }
    }
    expect(aborted).toBeNull();
  });
});
