import { InferenceService } from '../services/InferenceService';

// Native module absent — mock mode
jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: undefined,
}));

describe('InferenceService (mock mode)', () => {
  let service: InferenceService;

  beforeEach(() => {
    service = new InferenceService();
  });

  afterEach(async () => {
    await service.dispose();
  });

  it('initializes without native module', async () => {
    await expect(service.initialize()).resolves.not.toThrow();
    expect(service.isLoaded).toBe(true);
  });

  it('does not re-initialize on second call', async () => {
    await service.initialize();
    await service.initialize();
    expect(service.isLoaded).toBe(true);
  });

  it('returns mock response when native module absent', async () => {
    const result = await service.runInference('What is near me?');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('auto-initializes on first runInference call', async () => {
    expect(service.isLoaded).toBe(false);
    await service.runInference('test');
    expect(service.isLoaded).toBe(true);
  });

  it('dispose does not throw when native module absent', async () => {
    await service.initialize();
    await expect(service.dispose()).resolves.not.toThrow();
  });
});

describe('InferenceService (with native module)', () => {
  const mockLoadModel = jest.fn().mockResolvedValue(undefined);
  const mockRunInference = jest.fn().mockResolvedValue('You are near the Eiffel Tower.');
  const mockUnloadModel = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../native/LiteRTModule', () => ({
      __esModule: true,
      default: {
        loadModel: mockLoadModel,
        runInference: mockRunInference,
        isModelLoaded: jest.fn().mockResolvedValue(true),
        unloadModel: mockUnloadModel,
      },
    }));
    mockLoadModel.mockClear();
    mockRunInference.mockClear();
    mockUnloadModel.mockClear();
  });

  it('calls loadModel on initialize', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.initialize();
    expect(mockLoadModel).toHaveBeenCalledWith('gemma-4-e2b-it-int4.task');
  });

  it('calls runInference with prompt and maxTokens', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    const result = await svc.runInference('What is near me?', { maxTokens: 256 });
    expect(mockRunInference).toHaveBeenCalledWith('What is near me?', 256);
    expect(result).toBe('You are near the Eiffel Tower.');
  });

  it('uses default maxTokens when not specified', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.runInference('test');
    expect(mockRunInference).toHaveBeenCalledWith('test', 512);
  });

  it('calls unloadModel on dispose', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.initialize();
    await svc.dispose();
    expect(mockUnloadModel).toHaveBeenCalled();
    expect(svc.isLoaded).toBe(false);
  });
});
