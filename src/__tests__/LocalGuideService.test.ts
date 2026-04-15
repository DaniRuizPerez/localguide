import { localGuideService } from '../services/LocalGuideService';

jest.mock('../native/LiteRTModule', () => ({
  __esModule: true,
  default: undefined,
}));

describe('LocalGuideService', () => {
  const paris: { latitude: number; longitude: number; accuracy: number } = {
    latitude: 48.8566,
    longitude: 2.3522,
    accuracy: 10,
  };

  afterAll(async () => {
    await localGuideService.dispose();
  });

  it('returns a GuideResponse with all fields', async () => {
    const result = await localGuideService.ask('What is near me?', paris);
    expect(result.text).toBeTruthy();
    expect(result.locationUsed).toEqual(paris);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('trims whitespace from response text', async () => {
    const result = await localGuideService.ask('Any restaurants?', paris);
    expect(result.text).toBe(result.text.trim());
  });

  it('initializes without throwing', async () => {
    await expect(localGuideService.initialize()).resolves.not.toThrow();
  });

  it('works with GPS context missing accuracy', async () => {
    const noAccuracy = { latitude: 51.5074, longitude: -0.1278 };
    const result = await localGuideService.ask('Tell me about this area', noAccuracy);
    expect(result.locationUsed).toEqual(noAccuracy);
    expect(result.text).toBeTruthy();
  });

  it('dispose does not throw', async () => {
    await expect(localGuideService.dispose()).resolves.not.toThrow();
  });
});
