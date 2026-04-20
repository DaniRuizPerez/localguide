import { InferenceService } from '../services/InferenceService';

// Native module absent — mock mode
jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: undefined,
}));

// ModelDownloadService is touched during initialize(); stub it so we don't
// pull in expo-file-system's real document directory resolution.
jest.mock('../services/ModelDownloadService', () => ({
  modelDownloadService: {
    localPath: '/tmp/model.litertlm',
    profile: {
      multimodal: true,
      displayName: 'Test Model',
      fileName: 'model.litertlm',
    },
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1_000_000 }),
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
  const mockLoadModelFromPath = jest.fn().mockResolvedValue(undefined);
  const mockRunInference = jest.fn().mockResolvedValue('You are near the Eiffel Tower.');
  const mockUnloadModel = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../native/LiteRTModule', () => ({
      __esModule: true,
      default: {
        loadModelFromPath: mockLoadModelFromPath,
        runInference: mockRunInference,
        isModelLoaded: jest.fn().mockResolvedValue(true),
        unloadModel: mockUnloadModel,
      },
    }));
    jest.doMock('../services/ModelDownloadService', () => ({
      modelDownloadService: {
        localPath: '/tmp/model.litertlm',
        profile: {
          multimodal: true,
          displayName: 'Test Model',
          fileName: 'model.litertlm',
        },
      },
    }));
    jest.doMock('expo-file-system/legacy', () => ({
      getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1_000_000 }),
    }));
    mockLoadModelFromPath.mockClear();
    mockRunInference.mockClear();
    mockUnloadModel.mockClear();
  });

  it('calls loadModelFromPath on initialize with local path and multimodal flag', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.initialize();
    expect(mockLoadModelFromPath).toHaveBeenCalledWith('/tmp/model.litertlm', true);
  });

  it('calls runInference with prompt and maxTokens', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    const result = await svc.runInference('What is near me?', { maxTokens: 256 });
    expect(mockRunInference).toHaveBeenCalledWith('What is near me?', 256, null);
    expect(result).toBe('You are near the Eiffel Tower.');
  });

  it('uses default maxTokens when not specified', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.runInference('test');
    expect(mockRunInference).toHaveBeenCalledWith('test', 512, null);
  });

  it('forwards options.imagePath to native runInference', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.runInference('What am I looking at?', {
      maxTokens: 256,
      imagePath: 'file:///tmp/photo.jpg',
    });
    expect(mockRunInference).toHaveBeenCalledWith(
      'What am I looking at?',
      256,
      'file:///tmp/photo.jpg'
    );
  });

  it('passes null imagePath when options.imagePath is null', async () => {
    const { InferenceService: IS } = require('../services/InferenceService');
    const svc = new IS();
    await svc.runInference('text only', { imagePath: null });
    expect(mockRunInference).toHaveBeenCalledWith('text only', 512, null);
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
