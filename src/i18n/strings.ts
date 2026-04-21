// English baseline — every key lives here. Other locales override a subset;
// anything missing falls back to this file.
export const EN = {
  app: {
    ready: 'Ready when you are',
    warmupTitle: 'Getting your guide ready…',
    warmupSubtitle:
      'Loading the on-device model and warming up so your first question is fast.\nThis happens once per app launch.',
    pickTopic: 'WHILE YOU WAIT, PICK A TOPIC',
    warmupError: 'Warmup error: {message}',
  },
  nav: {
    chat: 'Chat',
    map: 'Map',
  },
  chat: {
    placeholder: "Ask about what's near you…",
    listening: 'Listening…',
    locating: 'Locating…',
    noGps: 'No GPS',
    autoGuide: 'AUTO-GUIDE',
    speak: 'SPEAK',
    stop: 'STOP',
    gotIt: 'GOT IT',
    set: 'SET',
    retryGps: 'Retry GPS',
    gpsUnavailable: 'GPS unavailable — enter a location to continue:',
    locationPlaceholder: 'e.g. Times Square, NYC',
    autoGuideListening: 'Auto-guide listening',
    autoGuideHint: 'Walk around and your guide will speak when something interesting is nearby.',
    askHint: "Ask about what's near you, tap the camera, or enable Auto-Guide.",
    slowDevice:
      '⚡  Heads up: this device has limited memory, so the AI guide runs on CPU and responses may be slow.',
    onDevice: 'ON DEVICE',
    identifyThis: 'What is this?',
    hiddenGems: 'HIDDEN GEMS',
  },
  compass: {
    accessibilityLabel: 'Compass pointing toward {label}',
    guideMeTo: 'Guide me to {label}',
    tapToClear: 'Tap to clear compass',
    noSensor: 'NO COMPASS',
  },
  map: {
    aroundYou: 'Around you now',
    stopsPickedOut: '{count} stops your guide picked out',
    scanning: 'Scanning for nearby stops…',
    wikipedia: 'Wikipedia',
    aiSuggested: 'AI suggested',
    gettingLocation: 'Getting your location…',
    locationUnavailable: 'Location unavailable',
    retry: 'Retry',
    clearTrail: 'Clear trail',
  },
  download: {
    heading: 'Making a tiny brain\nfor your pocket.',
    subtitle:
      '{mb} MB · one-time download · no account. After this, Local Guide works wherever you go.',
    wifiOnly: 'Wi-Fi only',
    start: 'Start download',
    pause: 'Pause download',
    resume: 'Resume download',
    retry: 'Retry',
    startExploring: 'Start exploring',
  },
  narration: {
    lengthShort: 'Short',
    lengthStandard: 'Standard',
    lengthDeepDive: 'Deep dive',
    voiceLabel: 'Voice',
    rateLabel: 'Speed',
    pause: 'Pause',
    resume: 'Resume',
    skip: 'Skip',
    settingsTitle: 'Narration',
    settingsButton: 'Voice & speed',
    lengthSection: 'LENGTH',
    voiceSystemDefault: 'System default',
    voiceNoneAvailable: 'No matching voices installed on this device.',
    done: 'Done',
  },
  itinerary: {
    title: 'I have {hours} hour(s)',
    button: 'Plan my day',
    generating: 'Planning your day…',
  },
  timeline: {
    title: 'Timeline',
    generating: 'Building timeline…',
  },
  quiz: {
    title: 'Local trivia',
    startButton: 'Start quiz',
    generating: 'Writing questions…',
    nextButton: 'Next',
    scoreLine: 'You got {correct} of {total}',
  },
  topics: {
    everything: 'Everything',
    history: 'History',
    nature: 'Nature',
    geography: 'Geography',
    food: 'Food',
    culture: 'Culture',
  },
};

export type StringKey = keyof typeof EN;
export type Strings = typeof EN;
