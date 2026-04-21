import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { speechService, type SpeechState } from './SpeechService';

// Keeps narration alive when the user pockets the phone mid-tour.
//
// Android's TextToSpeech engine itself runs in a separate system process, so
// the currently-playing sentence survives the Activity being paused. What can
// silently break is the JS thread firing speakNext() after onDone — if the OS
// suspends the process, the queue stalls.
//
// We hold a wake-lock via expo-keep-awake for as long as there's anything to
// speak. That:
//   * keeps the screen from sleeping while the guide is talking
//   * keeps the CPU awake so our JS queue drain runs on time even with the
//     app backgrounded
// and releases it immediately when the queue is empty so we don't drain the
// battery in idle.

const TAG = 'localguide-speech';

let installed = false;
let active = false;

function handleState(state: SpeechState): void {
  const shouldHold = state.isSpeaking || state.isPaused;
  if (shouldHold && !active) {
    active = true;
    activateKeepAwakeAsync(TAG).catch(() => {
      active = false;
    });
  } else if (!shouldHold && active) {
    active = false;
    deactivateKeepAwake(TAG).catch(() => {
      // No-op: the wake-lock may have already been released on app suspend.
    });
  }
}

export const speechBackgroundKeeper = {
  /** Wire up the subscription. Safe to call multiple times — idempotent. */
  install(): () => void {
    if (installed) return () => {};
    installed = true;
    const unsub = speechService.subscribe(handleState);
    return () => {
      unsub();
      installed = false;
      if (active) {
        active = false;
        deactivateKeepAwake(TAG).catch(() => {});
      }
    };
  },

  // Test hooks — never called from production code.
  __isActiveForTest(): boolean {
    return active;
  },
  __resetForTest(): void {
    installed = false;
    active = false;
  },
};
