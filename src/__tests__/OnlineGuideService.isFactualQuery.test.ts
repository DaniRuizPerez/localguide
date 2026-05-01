/**
 * Table tests for onlineGuideService.isFactualQuery().
 * Pure function — no mocks needed.
 */

import { onlineGuideService } from '../services/OnlineGuideService';

const { isFactualQuery } = onlineGuideService;

describe('isFactualQuery — true cases (short + no opinion words)', () => {
  it('"Stanford Memorial Church" → true', () => {
    expect(isFactualQuery('Stanford Memorial Church')).toBe(true);
  });

  it('"What is the Stanford Memorial Church?" → true (factual lookup)', () => {
    expect(isFactualQuery('What is the Stanford Memorial Church?')).toBe(true);
  });

  it('"Golden Gate Bridge" → true', () => {
    expect(isFactualQuery('Golden Gate Bridge')).toBe(true);
  });

  it('"Who built the Colosseum?" → true (factual, under 60 chars)', () => {
    expect(isFactualQuery('Who built the Colosseum?')).toBe(true);
  });

  it('"When was it founded?" → true', () => {
    expect(isFactualQuery('When was it founded?')).toBe(true);
  });

  it('empty string → true (no opinion words, length 0 < 60)', () => {
    expect(isFactualQuery('')).toBe(true);
  });

  it('exactly 59 chars with no opinion words → true', () => {
    // 59 'a's — no opinion words, just under the limit.
    const q = 'a'.repeat(59);
    expect(isFactualQuery(q)).toBe(true);
  });
});

describe('isFactualQuery — false cases (opinion word present)', () => {
  it('"Why is Stanford famous?" → false', () => {
    expect(isFactualQuery('Why is Stanford famous?')).toBe(false);
  });

  it('"How was it built?" → false', () => {
    expect(isFactualQuery('How was it built?')).toBe(false);
  });

  it('"Should I visit?" → false', () => {
    expect(isFactualQuery('Should I visit?')).toBe(false);
  });

  it('"Tell me about this place" → false (contains "tell me")', () => {
    expect(isFactualQuery('Tell me about this place')).toBe(false);
  });

  it('"Please explain the history" → false', () => {
    expect(isFactualQuery('Please explain the history')).toBe(false);
  });

  it('"What makes it special?" → false', () => {
    expect(isFactualQuery('What makes it special?')).toBe(false);
  });

  it('"In your opinion, is it worth seeing?" → false', () => {
    expect(isFactualQuery('In your opinion, is it worth seeing?')).toBe(false);
  });

  it('"What do you think about the architecture?" → false', () => {
    expect(isFactualQuery('What do you think about the architecture?')).toBe(false);
  });
});

describe('isFactualQuery — false cases (over 60 chars)', () => {
  it('a 70-char question with no opinion words → false', () => {
    // 70 chars, no opinion words — length alone triggers false.
    const q = 'What is the complete official name of the place we are standing at right';
    expect(q.length).toBeGreaterThanOrEqual(60);
    expect(isFactualQuery(q)).toBe(false);
  });

  it('exactly 60 chars → false (boundary is strict < 60)', () => {
    const q = 'a'.repeat(60);
    expect(isFactualQuery(q)).toBe(false);
  });

  it('long question with opinion word → false (both conditions fail)', () => {
    const q = 'Why is the Stanford Memorial Church considered the most beautiful campus building in California?';
    expect(q.length).toBeGreaterThan(60);
    expect(isFactualQuery(q)).toBe(false);
  });
});
