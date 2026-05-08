/**
 * StreamPostfilter — degenerate-output detector for the chat LLM stream.
 *
 * Hooked into useGuideStream's onToken callback. Watches a rolling tail of
 * the response and aborts inference when it sees:
 *
 *   - periodic repetition at any cycle length P (≥ 8 chars, ≥ 3 repeats)
 *   - single-char floods (≥ 40 of the same non-terminator char)
 *   - instruct/special-token leakage (`<|endoftext|>` etc.)
 *   - top-level JSON / code-fence spew where a chat answer was expected
 *
 * The same algorithm runs once at finalize() with a lower threshold (2
 * repeats) to trim trailing duplicate sentences from natural-finish answers.
 *
 * O(1) amortised per pushed char — small constant, well under 1 ms/token
 * on Pixel 3.
 */

export type AbortReason =
  | 'ok'
  | 'abort_repetition'
  | 'abort_flood'
  | 'abort_token'
  | 'abort_format';

export interface PostfilterOpts {
  tailCap?: number;
  minRepeatPeriod?: number;
  matchesBeforeAbort?: number;
  floodRunLen?: number;
  enabled?: boolean;
}

const DEFAULTS: Required<PostfilterOpts> = {
  tailCap: 256,
  minRepeatPeriod: 8,
  matchesBeforeAbort: 3,
  floodRunLen: 40,
  enabled: true,
};

const DENY_TOKENS = [
  '<|endoftext|>',
  '<eos>',
  '<bos>',
  '<start_of_turn>',
  '<end_of_turn>',
  '<image>',
];
const FORMAT_CHECK_LEN = 80;

export interface FinalizeResult {
  cleanedText: string;
  trimmedReason: AbortReason | null;
}

export class StreamPostfilter {
  private readonly opts: Required<PostfilterOpts>;
  private tail = '';
  private runChar = '';
  private runLen = 0;
  private aborted: AbortReason = 'ok';
  private abortPeriod = 0;
  private abortTokenLen = 0;

  constructor(opts: PostfilterOpts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    if (
      typeof globalThis !== 'undefined' &&
      (globalThis as { __POSTFILTER_DISABLED?: boolean }).__POSTFILTER_DISABLED === true
    ) {
      this.opts.enabled = false;
    }
  }

  pushDelta(delta: string): AbortReason {
    if (!this.opts.enabled || this.aborted !== 'ok' || !delta) return this.aborted;

    // Append to tail, keeping it capped.
    this.tail += delta;
    if (this.tail.length > this.opts.tailCap) {
      this.tail = this.tail.slice(-this.opts.tailCap);
    }

    // 1. Special-token leakage.
    for (const tok of DENY_TOKENS) {
      if (this.tail.endsWith(tok)) {
        this.abortTokenLen = tok.length;
        return (this.aborted = 'abort_token');
      }
    }

    // 2. Code-fence / raw-JSON spew at the very start of a chat answer.
    //    Only fires while the bubble is still in its first 80 chars — after
    //    that, a real answer has clearly started and we leave it alone.
    if (this.tail.length < FORMAT_CHECK_LEN) {
      const t = this.tail.trimStart();
      if (t.startsWith('```') || (t.length > 0 && t[0] === '{' && t.length >= 4)) {
        return (this.aborted = 'abort_format');
      }
    }

    // 3. Flood detector — walk the new chars only.
    for (let i = 0; i < delta.length; i += 1) {
      const ch = delta[i];
      if (ch === this.runChar) {
        this.runLen += 1;
      } else {
        this.runChar = ch;
        this.runLen = 1;
      }
      if (
        this.runLen >= this.opts.floodRunLen &&
        ch !== '.' &&
        ch !== '!' &&
        ch !== '?'
      ) {
        return (this.aborted = 'abort_flood');
      }
    }

    // 4. Periodic-repetition detector. For each candidate period P, check
    //    whether the last 3 blocks of length P at the tail are identical.
    //    Early-exit when the last char doesn't match the char 2P back, which
    //    rules out most P values in one comparison.
    const n = this.tail.length;
    const maxP = Math.floor(n / 3);
    for (let p = this.opts.minRepeatPeriod; p <= maxP; p += 1) {
      if (this.tail.charCodeAt(n - 1) !== this.tail.charCodeAt(n - 1 - p)) continue;
      if (this.tail.charCodeAt(n - 1) !== this.tail.charCodeAt(n - 1 - 2 * p)) continue;
      // Cheap prefix mismatch check before full slice equality.
      if (this.tail.charCodeAt(n - p) !== this.tail.charCodeAt(n - 2 * p)) continue;
      const block = this.tail.slice(n - p);
      // Single-char blocks (e.g. "xxxxxxxx") are floods, not phrase
      // repetition — let the flood detector handle them at its threshold.
      if (isSingleCharBlock(block)) continue;
      if (
        this.tail.slice(n - 2 * p, n - p) === block &&
        this.tail.slice(n - 3 * p, n - 2 * p) === block
      ) {
        if (this.opts.matchesBeforeAbort <= 3) {
          this.abortPeriod = p;
          return (this.aborted = 'abort_repetition');
        }
      }
    }

    return 'ok';
  }

  /**
   * Run once at end-of-stream. Trims trailing-repeat / token / flood remnants;
   * never aborts. Returns the cleaned full text + which (if any) trim happened.
   */
  finalize(): FinalizeResult {
    if (this.aborted !== 'ok') {
      return { cleanedText: this.getCleanedText(), trimmedReason: this.aborted };
    }
    if (!this.opts.enabled) {
      return { cleanedText: this.tail, trimmedReason: null };
    }

    // Trailing repetition with a lower threshold (2 blocks instead of 3).
    const n = this.tail.length;
    const maxP = Math.floor(n / 2);
    for (let p = this.opts.minRepeatPeriod; p <= maxP; p += 1) {
      const block = this.tail.slice(n - p);
      if (isSingleCharBlock(block)) continue;
      if (this.tail.slice(n - 2 * p, n - p) === block) {
        const stripped = this.tail.slice(0, n - p).trimEnd();
        return { cleanedText: stripped, trimmedReason: 'abort_repetition' };
      }
    }

    return { cleanedText: this.tail, trimmedReason: null };
  }

  /**
   * After a mid-stream abort, return the response text trimmed back to the
   * last "safe" point — before the repeating block, before the leaked token,
   * before the flood run.
   */
  getCleanedText(): string {
    if (this.aborted === 'abort_repetition' && this.abortPeriod > 0) {
      // Strip one full repeat block plus the partial start of the next.
      return this.tail.slice(0, Math.max(0, this.tail.length - 2 * this.abortPeriod)).trimEnd();
    }
    if (this.aborted === 'abort_token' && this.abortTokenLen > 0) {
      return this.tail.slice(0, this.tail.length - this.abortTokenLen).trimEnd();
    }
    if (this.aborted === 'abort_flood') {
      // Strip the trailing run of identical chars.
      let i = this.tail.length;
      while (i > 0 && this.tail[i - 1] === this.runChar) i -= 1;
      return this.tail.slice(0, i).trimEnd();
    }
    if (this.aborted === 'abort_format') {
      return '';
    }
    return this.tail;
  }
}

function isSingleCharBlock(block: string): boolean {
  if (block.length === 0) return true;
  const first = block.charCodeAt(0);
  for (let i = 1; i < block.length; i += 1) {
    if (block.charCodeAt(i) !== first) return false;
  }
  return true;
}

/** Map an abort reason to the inline trailer the user sees in the bubble. */
export function trailerFor(reason: AbortReason): string {
  switch (reason) {
    case 'abort_repetition':
      return '_(stopped — got stuck repeating)_';
    case 'abort_flood':
      return '_(stopped — output was breaking up)_';
    case 'abort_format':
      return "_(couldn't generate a chat answer this time — try again)_";
    case 'abort_token':
    case 'ok':
    default:
      return '';
  }
}
