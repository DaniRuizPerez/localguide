import { inferenceService, type InferenceOptions } from './InferenceService';

export interface AbortableTask<T> {
  promise: Promise<T>;
  abort: () => Promise<void>;
}

/**
 * Stream a prompt through the on-device model, accumulate tokens into a single
 * string, run `parse` when generation completes, and expose the result as an
 * abortable promise.
 *
 * Replaces the "build prompt → start stream → buffer tokens → parse on done →
 * wire abort handle" boilerplate that used to be copy-pasted in every method of
 * LocalGuideService that returns structured output.
 */
export function runParsedStream<T>(
  prompt: string,
  parse: (raw: string) => T,
  options: InferenceOptions = {}
): AbortableTask<T> {
  let handleRef: Awaited<ReturnType<typeof inferenceService.runInferenceStream>> | null = null;
  let settled = false;

  const promise = new Promise<T>((resolve, reject) => {
    let fullText = '';
    inferenceService
      .runInferenceStream(
        prompt,
        {
          onToken: (delta) => {
            fullText += delta;
          },
          onDone: () => {
            settled = true;
            try {
              resolve(parse(fullText));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          },
          onError: (message) => {
            settled = true;
            reject(new Error(message));
          },
        },
        options
      )
      .then((handle) => {
        if (settled) {
          // The stream resolved (or errored) before the handle was captured —
          // nothing to abort.
          handle.abort();
          return;
        }
        handleRef = handle;
      })
      .catch((err) => {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });

  return {
    promise,
    abort: async () => {
      if (handleRef) await handleRef.abort();
      settled = true;
    },
  };
}
