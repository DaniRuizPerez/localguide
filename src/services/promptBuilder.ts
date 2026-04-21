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
   * The user-facing cue / question, e.g. "Narrate what's interesting here".
   * Optional — some prompts (nearby-places listing) don't need a separate
   * cue because the task is fully specified in extraContext.
   */
  cue?: string;
}

export function buildNarratorPrompt(parts: NarratorPromptParts): string {
  const { system, directives = [], place = null, omitCoordsWithPlace = true, extraContext, cue } = parts;

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
