/**
 * Covers the streaming path added for token-by-token inference:
 * InferenceService.runInferenceStream wires up events from the native module
 * and fires onToken/onDone/onError callbacks. Tests drive the native emitter
 * to simulate a generation.
 */

import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockEmitter = new EventEmitter();
const mockRunInferenceStream = jest.fn().mockResolvedValue(undefined);
const mockAbortInference = jest.fn().mockResolvedValue(undefined);
const mockLoadModel = jest.fn().mockResolvedValue(undefined);

// react-native's NativeEventEmitter API is a subset of Node's EventEmitter,
// but uses `addListener` + `{ remove }` subscription handles.
jest.mock('react-native', () => {
  class NativeEventEmitter {
    constructor(_module?: unknown) {}
    addListener(event: string, cb: (arg: unknown) => void) {
      mockEmitter.on(event, cb);
      return {
        remove: () => mockEmitter.off(event, cb),
      };
    }
  }
  return {
    NativeEventEmitter,
    NativeModules: {
      LiteRTModule: {
        runInferenceStream: mockRunInferenceStream,
        abortInference: mockAbortInference,
      },
    },
  };
});

jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: {
    loadModel: mockLoadModel,
    loadModelFromPath: jest.fn().mockResolvedValue(undefined),
    runInference: jest.fn().mockResolvedValue('ignored'),
    runInferenceStream: mockRunInferenceStream,
    abortInference: mockAbortInference,
    unloadModel: jest.fn().mockResolvedValue(undefined),
    isModelLoaded: jest.fn().mockResolvedValue(true),
  },
  LITERT_EVENT_TOKEN: 'LiteRTToken',
  LITERT_EVENT_DONE: 'LiteRTDone',
  LITERT_EVENT_ERROR: 'LiteRTError',
}));

// ModelDownloadService referenced during initialize()
jest.mock('../services/ModelDownloadService', () => ({
  MODEL_LOCAL_PATH: '/tmp/model.litertlm',
  modelDownloadService: {
    localPath: '/tmp/model.litertlm',
    profile: {
      multimodal: true,
      displayName: 'Test Model',
      fileName: 'model.litertlm',
    },
  },
}));

// Ensure the model file looks present so initialize() proceeds to the native
// loadModelFromPath call instead of throwing.
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1_000_000 }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('InferenceService.runInferenceStream', () => {
  let service: import('../services/InferenceService').InferenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter.removeAllListeners();
    const { InferenceService } = require('../services/InferenceService');
    service = new InferenceService();
  });

  function getRequestId(): string {
    const lastCall = mockRunInferenceStream.mock.calls[mockRunInferenceStream.mock.calls.length - 1];
    return lastCall[1];
  }

  it('calls native runInferenceStream with prompt, requestId, and null image', async () => {
    await service.runInferenceStream('Hello', {
      onToken: jest.fn(),
      onDone: jest.fn(),
      onError: jest.fn(),
    });
    expect(mockRunInferenceStream).toHaveBeenCalledTimes(1);
    const [prompt, requestId, imagePath] = mockRunInferenceStream.mock.calls[0];
    expect(prompt).toBe('Hello');
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
    expect(imagePath).toBeNull();
  });

  it('forwards imagePath to the native module', async () => {
    await service.runInferenceStream(
      'Describe this',
      { onToken: jest.fn(), onDone: jest.fn(), onError: jest.fn() },
      { imagePath: 'file:///tmp/photo.jpg' }
    );
    expect(mockRunInferenceStream.mock.calls[0][2]).toBe('file:///tmp/photo.jpg');
  });

  it('fires onToken for each matching LiteRTToken event', async () => {
    const onToken = jest.fn();
    await service.runInferenceStream('x', { onToken, onDone: jest.fn(), onError: jest.fn() });
    const requestId = getRequestId();
    mockEmitter.emit('LiteRTToken', { requestId, delta: 'Hel' });
    mockEmitter.emit('LiteRTToken', { requestId, delta: 'lo' });
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(onToken).toHaveBeenNthCalledWith(1, 'Hel');
    expect(onToken).toHaveBeenNthCalledWith(2, 'lo');
  });

  it('ignores events whose requestId does not match', async () => {
    const onToken = jest.fn();
    await service.runInferenceStream('x', { onToken, onDone: jest.fn(), onError: jest.fn() });
    mockEmitter.emit('LiteRTToken', { requestId: 'different', delta: 'leak' });
    expect(onToken).not.toHaveBeenCalled();
  });

  it('fires onDone when LiteRTDone arrives and stops forwarding tokens', async () => {
    const onToken = jest.fn();
    const onDone = jest.fn();
    await service.runInferenceStream('x', { onToken, onDone, onError: jest.fn() });
    const requestId = getRequestId();
    mockEmitter.emit('LiteRTToken', { requestId, delta: 'first' });
    mockEmitter.emit('LiteRTDone', { requestId });
    mockEmitter.emit('LiteRTToken', { requestId, delta: 'late' }); // should be ignored
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fires onError when LiteRTError arrives with the error message', async () => {
    const onError = jest.fn();
    await service.runInferenceStream('x', { onToken: jest.fn(), onDone: jest.fn(), onError });
    const requestId = getRequestId();
    mockEmitter.emit('LiteRTError', { requestId, message: 'boom' });
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('does not fire onDone after onError', async () => {
    const onDone = jest.fn();
    const onError = jest.fn();
    await service.runInferenceStream('x', { onToken: jest.fn(), onDone, onError });
    const requestId = getRequestId();
    mockEmitter.emit('LiteRTError', { requestId, message: 'boom' });
    mockEmitter.emit('LiteRTDone', { requestId });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('reports native-module rejections via onError', async () => {
    mockRunInferenceStream.mockRejectedValueOnce(new Error('NOT_LOADED'));
    const onError = jest.fn();
    await service.runInferenceStream('x', { onToken: jest.fn(), onDone: jest.fn(), onError });
    expect(onError).toHaveBeenCalledWith('NOT_LOADED');
  });

  it('abort() calls native abortInference and suppresses later events', async () => {
    const onToken = jest.fn();
    const onDone = jest.fn();
    const handle = await service.runInferenceStream('x', {
      onToken,
      onDone,
      onError: jest.fn(),
    });
    const requestId = getRequestId();
    await handle.abort();
    expect(mockAbortInference).toHaveBeenCalledTimes(1);

    // Events after abort must not reach callbacks.
    mockEmitter.emit('LiteRTToken', { requestId, delta: 'late' });
    mockEmitter.emit('LiteRTDone', { requestId });
    expect(onToken).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('removes listeners after onDone (no handler leaks)', async () => {
    await service.runInferenceStream('x', {
      onToken: jest.fn(),
      onDone: jest.fn(),
      onError: jest.fn(),
    });
    const requestId = getRequestId();
    expect(mockEmitter.listenerCount('LiteRTToken')).toBeGreaterThan(0);
    mockEmitter.emit('LiteRTDone', { requestId });
    expect(mockEmitter.listenerCount('LiteRTToken')).toBe(0);
    expect(mockEmitter.listenerCount('LiteRTDone')).toBe(0);
    expect(mockEmitter.listenerCount('LiteRTError')).toBe(0);
  });

  it('each call gets a unique requestId', async () => {
    await service.runInferenceStream('a', { onToken: jest.fn(), onDone: jest.fn(), onError: jest.fn() });
    const firstId = getRequestId();
    mockEmitter.emit('LiteRTDone', { requestId: firstId });
    await service.runInferenceStream('b', { onToken: jest.fn(), onDone: jest.fn(), onError: jest.fn() });
    const secondId = getRequestId();
    expect(secondId).not.toBe(firstId);
  });
});
