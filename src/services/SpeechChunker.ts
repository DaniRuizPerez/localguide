/**
 * Streaming-text chunker that yields speakable segments as tokens arrive.
 *
 * Feed tokens via `push(delta)`. Flushes a segment when the accumulator
 * contains a sentence boundary (`.`, `!`, `?`) followed by whitespace, or
 * when it reaches `softMaxChars` without finding one (to keep TTS from
 * lagging on long clauses). Call `flush()` at end-of-stream to speak any
 * remaining text.
 */
export class SpeechChunker {
  private buffer = '';
  private readonly onSegment: (segment: string) => void;
  private readonly softMaxChars: number;
  private readonly minFirstChars: number;
  private firstFlushed = false;

  constructor(
    onSegment: (segment: string) => void,
    options: { softMaxChars?: number; minFirstChars?: number } = {}
  ) {
    this.onSegment = onSegment;
    this.softMaxChars = options.softMaxChars ?? 120;
    // Default to 1: emit the first complete sentence as soon as it lands, so TTS
    // kicks in as early as possible. A larger threshold here means responses that
    // open with a short sentence ("Hi!") — or short responses overall — never
    // trigger mid-stream TTS at all.
    this.minFirstChars = options.minFirstChars ?? 1;
  }

  push(delta: string): void {
    if (!delta) return;
    this.buffer += delta;
    this.drain();
  }

  flush(): void {
    const remaining = this.buffer.trim();
    if (remaining) {
      this.onSegment(remaining);
    }
    this.buffer = '';
  }

  private drain(): void {
    // Emit complete sentences greedily. The first segment only fires once
    // we have `minFirstChars` of buffered text so TTS isn't kicked off by a
    // stray "Hi." at the top of the response.
    while (true) {
      const minChars = this.firstFlushed ? 1 : this.minFirstChars;
      if (this.buffer.length < minChars) return;

      const boundary = this.findSentenceBoundary();
      if (boundary !== -1) {
        const segment = this.buffer.slice(0, boundary + 1).trim();
        this.buffer = this.buffer.slice(boundary + 1);
        if (segment) {
          this.firstFlushed = true;
          this.onSegment(segment);
        }
        continue;
      }

      if (this.buffer.length >= this.softMaxChars) {
        // No sentence boundary but buffer is large — cut at last space.
        const cut = this.findSoftCut();
        const segment = this.buffer.slice(0, cut).trim();
        this.buffer = this.buffer.slice(cut);
        if (segment) {
          this.firstFlushed = true;
          this.onSegment(segment);
        }
        continue;
      }

      return;
    }
  }

  private findSentenceBoundary(): number {
    for (let i = 0; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
        const next = this.buffer[i + 1];
        if (next === undefined) {
          // Trailing punctuation — wait for the next token to confirm sentence end.
          return -1;
        }
        if (next === ' ' || next === '\n' || next === '\t') {
          return i;
        }
      }
    }
    return -1;
  }

  private findSoftCut(): number {
    // Prefer cutting at the last whitespace within softMaxChars.
    for (let i = this.softMaxChars - 1; i > 0; i -= 1) {
      const ch = this.buffer[i];
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        return i;
      }
    }
    return this.softMaxChars;
  }
}