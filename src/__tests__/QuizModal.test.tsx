/**
 * QuizModal — Wave 5 source attribution strip tests.
 *
 * Verifies that the modal renders an offline disclaimer when any question
 * has source='ai-offline', and a Wikipedia attribution strip when all
 * questions have source='wikipedia'.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

// ── Minimal RN mocks ────────────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}(${Object.values(params).join(',')})`;
    }
    return key;
  },
  localePromptDirective: () => '',
}));

// Mock the LocalGuideService so QuizModal never attempts real inference.
// The mock's generateQuizStream / attachPrefetchedQuiz controls what questions
// are surfaced — individual tests inject questions directly via state.
jest.mock('../services/LocalGuideService', () => ({
  localGuideService: {
    generateQuizStream: jest.fn(() => ({ abort: jest.fn().mockResolvedValue(undefined) })),
    attachPrefetchedQuiz: jest.fn(() => null),
    prefetchQuiz: jest.fn(),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

import type { QuizQuestion } from '../services/LocalGuideService';

function makeQ(source?: QuizQuestion['source']): QuizQuestion {
  return {
    question: 'What is the capital of France?',
    options: ['London', 'Berlin', 'Paris', 'Madrid'],
    correctIndex: 2,
    source,
  };
}

// We render QuizModal and immediately inject questions via the onQuestion
// callback captured from the generateQuizStream mock so we can test the
// source strip without wiring the full quiz flow.
import { localGuideService } from '../services/LocalGuideService';
import { QuizModal } from '../components/QuizModal';

type StreamHandlers = {
  onQuestion: (q: QuizQuestion, i: number) => void;
  onDone: (qs: QuizQuestion[]) => void;
  onError: (msg: string) => void;
};

let capturedHandlers: StreamHandlers | null = null;

beforeEach(() => {
  capturedHandlers = null;
  (localGuideService.generateQuizStream as jest.Mock).mockImplementation(
    (_titles, _count, handlers: StreamHandlers) => {
      capturedHandlers = handlers;
      return { abort: jest.fn().mockResolvedValue(undefined) };
    }
  );
  (localGuideService.attachPrefetchedQuiz as jest.Mock).mockReturnValue(null);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QuizModal source attribution strip', () => {
  const dummyPoi = { title: 'Stanford', latitude: 37.4, longitude: -122.1, source: 'wikipedia' as const, pageId: 1, distanceMeters: 100 };

  it('renders offline strip when any question has source="ai-offline"', () => {
    const { getByTestId, queryByTestId } = render(
      <QuizModal visible nearbyPois={[dummyPoi]} onClose={() => {}} />
    );

    // Inject one offline question via the captured stream handlers.
    act(() => {
      capturedHandlers!.onQuestion(makeQ('ai-offline'), 0);
      capturedHandlers!.onDone([makeQ('ai-offline')]);
    });

    expect(getByTestId('offline-strip')).toBeTruthy();
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });

  it('renders Wikipedia attribution when all questions have source="wikipedia"', () => {
    const { getByTestId, queryByTestId } = render(
      <QuizModal visible nearbyPois={[dummyPoi]} onClose={() => {}} />
    );

    act(() => {
      capturedHandlers!.onQuestion(makeQ('wikipedia'), 0);
      capturedHandlers!.onDone([makeQ('wikipedia')]);
    });

    expect(getByTestId('wikipedia-strip')).toBeTruthy();
    expect(queryByTestId('offline-strip')).toBeNull();
  });

  it('renders no strip when questions have source="ai-online"', () => {
    const { queryByTestId } = render(
      <QuizModal visible nearbyPois={[dummyPoi]} onClose={() => {}} />
    );

    act(() => {
      capturedHandlers!.onQuestion(makeQ('ai-online'), 0);
      capturedHandlers!.onDone([makeQ('ai-online')]);
    });

    expect(queryByTestId('offline-strip')).toBeNull();
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });

  it('renders no strip when questions have no source set', () => {
    const { queryByTestId } = render(
      <QuizModal visible nearbyPois={[dummyPoi]} onClose={() => {}} />
    );

    act(() => {
      capturedHandlers!.onQuestion(makeQ(undefined), 0);
      capturedHandlers!.onDone([makeQ(undefined)]);
    });

    expect(queryByTestId('offline-strip')).toBeNull();
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });

  it('prefers offline strip when mix of ai-offline and wikipedia', () => {
    const { getByTestId, queryByTestId } = render(
      <QuizModal visible nearbyPois={[dummyPoi]} onClose={() => {}} />
    );

    act(() => {
      const qs = [makeQ('wikipedia'), makeQ('ai-offline')];
      capturedHandlers!.onQuestion(qs[0], 0);
      capturedHandlers!.onQuestion(qs[1], 1);
      capturedHandlers!.onDone(qs);
    });

    // Any ai-offline → offline strip takes precedence.
    expect(getByTestId('offline-strip')).toBeTruthy();
    // Not all are wikipedia, so no wikipedia strip.
    expect(queryByTestId('wikipedia-strip')).toBeNull();
  });
});
