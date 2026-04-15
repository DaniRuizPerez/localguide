import { ModelDownloadService, MODEL_LOCAL_PATH, MODEL_DIR } from '../services/ModelDownloadService';

// Mock expo-file-system
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockCreateDownloadResumable = jest.fn();

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///data/user/0/com.localguideapp/files/',
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  createDownloadResumable: (...args: unknown[]) => mockCreateDownloadResumable(...args),
}));

// Mock global fetch for HEAD requests
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ModelDownloadService', () => {
  let service: ModelDownloadService;

  beforeEach(() => {
    service = new ModelDownloadService();
    jest.clearAllMocks();
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  describe('isModelDownloaded', () => {
    it('returns true when model file exists with non-zero size', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500_000_000 });
      await expect(service.isModelDownloaded()).resolves.toBe(true);
      expect(mockGetInfoAsync).toHaveBeenCalledWith(MODEL_LOCAL_PATH);
    });

    it('returns false when file does not exist', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: false });
      await expect(service.isModelDownloaded()).resolves.toBe(false);
    });

    it('returns false when file exists but size is 0', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true, size: 0 });
      await expect(service.isModelDownloaded()).resolves.toBe(false);
    });
  });

  describe('getRemoteFileSize', () => {
    it('returns content-length from HEAD response', async () => {
      mockFetch.mockResolvedValue({
        headers: { get: (h: string) => (h === 'Content-Length' ? '512000000' : null) },
      });
      await expect(service.getRemoteFileSize()).resolves.toBe(512_000_000);
    });

    it('returns null when Content-Length header is absent', async () => {
      mockFetch.mockResolvedValue({ headers: { get: () => null } });
      await expect(service.getRemoteFileSize()).resolves.toBeNull();
    });

    it('returns null when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      await expect(service.getRemoteFileSize()).resolves.toBeNull();
    });
  });

  describe('startDownload', () => {
    it('creates model directory if missing', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: false });
      const mockDownloadAsync = jest.fn().mockResolvedValue({ status: 200 });
      mockCreateDownloadResumable.mockReturnValue({ downloadAsync: mockDownloadAsync });

      await service.startDownload(jest.fn());

      expect(mockMakeDirectoryAsync).toHaveBeenCalledWith(MODEL_DIR, { intermediates: true });
    });

    it('does not create directory when it already exists', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      const mockDownloadAsync = jest.fn().mockResolvedValue({ status: 200 });
      mockCreateDownloadResumable.mockReturnValue({ downloadAsync: mockDownloadAsync });

      await service.startDownload(jest.fn());

      expect(mockMakeDirectoryAsync).not.toHaveBeenCalled();
    });

    it('sets status to done on successful download', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
      });

      await service.startDownload(jest.fn());

      expect(service.status).toBe('done');
    });

    it('sets status to error on non-200 response', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ status: 403 }),
      });

      await service.startDownload(jest.fn());

      expect(service.status).toBe('error');
      expect(service.error).toContain('403');
    });

    it('calls progress callback with fractional progress', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      let capturedCallback: ((p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined;

      mockCreateDownloadResumable.mockImplementation(
        (_url: string, _dest: string, _opts: unknown, callback: (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) => {
          capturedCallback = callback;
          return {
            downloadAsync: jest.fn().mockImplementation(async () => {
              capturedCallback!({ totalBytesWritten: 500, totalBytesExpectedToWrite: 1000 });
              return { status: 200 };
            }),
          };
        }
      );

      const onProgress = jest.fn();
      await service.startDownload(onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ bytesDownloaded: 500, bytesTotal: 1000, fraction: 0.5 })
      );
    });

    it('sets status to error and throws on network failure', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockRejectedValue(new Error('network error')),
      });

      await expect(service.startDownload(jest.fn())).rejects.toThrow('network error');
      expect(service.status).toBe('error');
      expect(service.error).toBe('network error');
    });
  });

  describe('pauseDownload', () => {
    it('pauses and sets status to paused', async () => {
      mockGetInfoAsync.mockResolvedValue({ exists: true });
      const mockPauseAsync = jest.fn().mockResolvedValue(undefined);
      const mockDownloadAsync = jest.fn().mockResolvedValue({ status: 200 });
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: mockDownloadAsync,
        pauseAsync: mockPauseAsync,
      });

      // Start download without awaiting to leave it in 'downloading' state
      const downloadPromise = service.startDownload(jest.fn());
      // Status is now 'downloading'
      await service.pauseDownload();

      expect(mockPauseAsync).toHaveBeenCalled();
      expect(service.status).toBe('paused');

      // Let download finish
      await downloadPromise;
    });

    it('does nothing when not downloading', async () => {
      await service.pauseDownload(); // no-op
      expect(service.status).toBe('idle');
    });
  });

  describe('retryDownload', () => {
    it('deletes partial file and restarts download', async () => {
      // Simulate a partial file exists
      mockGetInfoAsync
        .mockResolvedValueOnce({ exists: true }) // deleteAsync check
        .mockResolvedValueOnce({ exists: true }); // dir check in startDownload

      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
      });

      await service.retryDownload(jest.fn());

      expect(mockDeleteAsync).toHaveBeenCalledWith(MODEL_LOCAL_PATH, { idempotent: true });
      expect(service.status).toBe('done');
    });
  });

  describe('deleteModel', () => {
    it('deletes model file', async () => {
      await service.deleteModel();
      expect(mockDeleteAsync).toHaveBeenCalledWith(MODEL_LOCAL_PATH, { idempotent: true });
      expect(service.status).toBe('idle');
    });
  });
});
