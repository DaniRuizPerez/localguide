/**
 * Tests for the per-call referenceMaxChars parameter on buildNarratorPrompt.
 *
 * Covers W2 spec:
 *   - default 600 applies when referenceMaxChars is omitted
 *   - referenceMaxChars: 1500 allows longer references (online RAG)
 *   - 0-length reference is still elided (existing behavior unchanged)
 */

import { buildNarratorPrompt } from '../services/promptBuilder';

const BASE = { system: 'SYS', cue: 'Go.' };

describe('buildNarratorPrompt — referenceMaxChars', () => {
  it('default 600-char clamp still applies when referenceMaxChars is not set', () => {
    // Build a reference of 800 chars with a sentence boundary before 600.
    const sentenceA = 'A'.repeat(300) + '.'; // 301 chars
    const sentenceB = 'B'.repeat(500) + '.'; // 501 chars; total 802
    const ref = sentenceA + sentenceB;
    expect(ref.length).toBeGreaterThan(600);

    const p = buildNarratorPrompt({ ...BASE, reference: ref });
    expect(p).toContain(sentenceA);
    expect(p).not.toContain(sentenceB);
  });

  it('referenceMaxChars: 1500 allows references up to 1500 chars without truncation', () => {
    // 1400-char reference — fits within 1500 so it should pass through unchanged.
    const ref = 'W'.repeat(1400);
    const p = buildNarratorPrompt({ ...BASE, reference: ref, referenceMaxChars: 1500 });
    expect(p).toContain('W'.repeat(1400));
  });

  it('referenceMaxChars: 1500 still clamps references exceeding 1500 chars', () => {
    // 1600-char reference with a sentence boundary before 1500.
    const sentenceA = 'C'.repeat(800) + '.'; // 801 chars
    const sentenceB = 'D'.repeat(800) + '.'; // 801 chars; total 1602
    const ref = sentenceA + sentenceB;
    expect(ref.length).toBeGreaterThan(1500);

    const p = buildNarratorPrompt({ ...BASE, reference: ref, referenceMaxChars: 1500 });
    expect(p).toContain(sentenceA);
    expect(p).not.toContain(sentenceB);
  });

  it('0-length reference is still elided regardless of referenceMaxChars', () => {
    const withEmpty = buildNarratorPrompt({ ...BASE, reference: '', referenceMaxChars: 1500 });
    const withUndefined = buildNarratorPrompt({ ...BASE });
    expect(withEmpty).toBe(withUndefined);
    expect(withEmpty).not.toContain('Reference');
  });

  it('undefined reference is elided regardless of referenceMaxChars', () => {
    const withUndefined = buildNarratorPrompt({ ...BASE, reference: undefined, referenceMaxChars: 1500 });
    const plain = buildNarratorPrompt({ ...BASE });
    expect(withUndefined).toBe(plain);
  });

  it('referenceMaxChars: 600 behaves identically to omitting it', () => {
    const ref = 'E'.repeat(500) + '.'; // 501 chars — under both 600 and 1500
    const withExplicit = buildNarratorPrompt({ ...BASE, reference: ref, referenceMaxChars: 600 });
    const withDefault = buildNarratorPrompt({ ...BASE, reference: ref });
    expect(withExplicit).toBe(withDefault);
  });

  it('reference block appears after extraContext and before cue with custom clamp', () => {
    const ref = 'Wikipedia extract about the place.';
    const p = buildNarratorPrompt({
      ...BASE,
      extraContext: 'Some extra context.',
      reference: ref,
      referenceMaxChars: 1500,
    });
    const lines = p.split('\n');
    const extraIdx = lines.indexOf('Some extra context.');
    const refHeaderIdx = lines.indexOf('Reference (use as ground truth — rephrase but never contradict):');
    const refBodyIdx = lines.indexOf(ref);
    const cueIdx = lines.indexOf('Cue: Go.');
    expect(refHeaderIdx).toBeGreaterThan(extraIdx);
    expect(refBodyIdx).toBe(refHeaderIdx + 1);
    expect(cueIdx).toBeGreaterThan(refBodyIdx);
  });
});
