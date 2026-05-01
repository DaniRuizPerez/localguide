import type { GPSContext } from './InferenceService';

/**
 * Narrator-style prompt builder. Replaces the string-concat chain that the
 * LocalGuideService prompt functions used to do inline. Each optional field
 * is silently dropped when falsy, so callers don't need ternaries.
 *
 * Shape of the rendered prompt (empty fields elided):
 *
 *   <system>
 *   [directives joined with '\n']
 *
 *   Place: <place>
 *   Coordinates: <coords>
 *   <extraContext>
 *   Reference (use as ground truth — rephrase but never contradict):
 *   <reference, clamped to 600 chars>
 *   Cue: <cue>
 */
export interface NarratorPromptParts {
  /** The required system / role preamble. */
  system: string;
  /**
   * Optional directives appended below the system prompt, one per line.
   * Falsy values (false, null, undefined, '') are skipped, so callers can
   * pass `flag && 'do X'` inline without guarding.
   */
  directives?: Array<string | false | null | undefined>;
  /**
   * The visitor's current location. When this has a place name, the
   * "Coordinates:" line is omitted by default (see omitCoordsWithPlace).
   * When the whole field is null, the location block is empty.
   */
  place?: GPSContext | string | null;
  /**
   * When `place` has a placeName, drop the Coordinates line entirely.
   * Default true — Gemma 3 1B tends to parrot numbers back into the
   * narration even when told not to, so we hide them when we have a name.
   */
  omitCoordsWithPlace?: boolean;
  /** Extra freeform context inserted between the location block and the cue. */
  extraContext?: string;
  /**
   * Optional grounded reference text (e.g. from a RAG retrieval).
   * Hard-capped at referenceMaxChars (default 600; online RAG passes 1500).
   * Rendered after extraContext and before the cue as a "Reference:" block.
   */
  reference?: string;
  /**
   * Override the reference clamp. Default 600 (Pixel 3 offline prefill budget).
   * Online RAG callers should pass 1500 to keep enough Wikipedia context.
   */
  referenceMaxChars?: number;
  /**
   * The user-facing cue / question, e.g. "Narrate what's interesting here".
   * Optional — some prompts (nearby-places listing) don't need a separate
   * cue because the task is fully specified in extraContext.
   */
  cue?: string;
}

/** Default max reference length (offline; online RAG passes 1500). */
const REFERENCE_MAX_CHARS_DEFAULT = 600;

/**
 * Clamps `text` to at most `maxChars` characters.
 * Prefers trimming at the last sentence boundary (.  !  ?) before the limit;
 * falls back to a hard cut + ellipsis when no boundary exists.
 */
export function clampToSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  // Find the last sentence-ending punctuation within the slice.
  const boundary = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
  if (boundary > 0) return text.slice(0, boundary + 1);
  return `${slice}…`;
}

export function buildNarratorPrompt(parts: NarratorPromptParts): string {
  const { system, directives = [], place = null, omitCoordsWithPlace = true, extraContext, reference, referenceMaxChars = REFERENCE_MAX_CHARS_DEFAULT, cue } = parts;

  const header = [system];
  for (const d of directives) {
    if (d) header.push(d);
  }

  const placeLine = renderPlaceLine(place);
  const coordsLine = renderCoordsLine(place, omitCoordsWithPlace);

  const bodyParts: string[] = [];
  if (placeLine) bodyParts.push(placeLine);
  if (coordsLine) bodyParts.push(coordsLine);
  if (extraContext) bodyParts.push(extraContext);
  if (reference) {
    const clamped = clampToSentence(reference, referenceMaxChars);
    bodyParts.push(`Reference (use as ground truth — rephrase but never contradict):\n${clamped}`);
  }
  if (cue) bodyParts.push(`Cue: ${cue}`);

  return `${header.join('\n')}\n${bodyParts.join('\n')}`;
}

export function formatCoordinates(location: GPSContext | string): string {
  if (typeof location === 'string') return location;
  const accuracyNote = location.accuracy != null ? ` (±${Math.round(location.accuracy)}m)` : '';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}${accuracyNote}`;
}

function renderPlaceLine(place: GPSContext | string | null): string | null {
  if (place == null) return null;
  if (typeof place === 'string') return `Place: ${place}`;
  return place.placeName ? `Place: ${place.placeName}` : null;
}

function renderCoordsLine(
  place: GPSContext | string | null,
  omitWhenPlaceName: boolean
): string | null {
  if (place == null) return null;
  const hasPlaceName = typeof place === 'string' || !!place.placeName;
  if (omitWhenPlaceName && hasPlaceName) return null;
  return `Coordinates: ${formatCoordinates(place)}`;
}
