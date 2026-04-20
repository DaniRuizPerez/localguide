import { ModelDownloadService, MODEL_LOCAL_PATH, MODEL_DIR } from '../services/ModelDownloadService';

// Mock expo-file-system
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn();
const mockDeleteAsync = jest.fn();
const mockCreateDownloadResumable = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.localguideapp/files/',
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  createDownloadResumable: (...args: unknown[]) => mockCreateDownloadResumable(...args),
}));

// Mock global fetch for HEAD requests
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Default HEAD-probe response used by startDownload. Individual tests override
// this when they need to simulate a 401/403 or HTML body.
function defaultHeadResponse() {
  return {
    status: 200,
    url: 'https://cdn.example/resolved',
    headers: {
      get: (h: string) => (h === 'Content-Type' ? 'application/octet-stream' : null),
    },
  };
}

describe('ModelDownloadService', () => {
  let service: ModelDownloadService;

  beforeEach(() => {
    service = new ModelDownloadService();
    jest.clearAllMocks();
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
    // Default HEAD probe response so startDownload can make it past its
    // gated-repo classification before hitting the createDownloadResumable path.
    mockFetch.mockResolvedValue(defaultHeadResponse());
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
    // startDownload does (1) _ensureModelDir getInfoAsync, (2) pre-delete check
    // getInfoAsync, (3) final post-download size check. The size gate requires
    // >100 MB to mark status 'done' — tests that only care about state
    // transitions return a large fake size for every call.
    const bigFileInfo = { exists: true, size: 200_000_000 };

    it('creates model directory if missing', async () => {
      mockGetInfoAsync
        .mockResolvedValueOnce({ exists: false }) // dir missing
        .mockResolvedValueOnce({ exists: false }) // no stale file
        .mockResolvedValueOnce(bigFileInfo); // final size check
      const mockDownloadAsync = jest.fn().mockResolvedValue({ status: 200 });
      mockCreateDownloadResumable.mockReturnValue({ downloadAsync: mockDownloadAsync });

      await service.startDownload(jest.fn());

      expect(mockMakeDirectoryAsync).toHaveBeenCalledWith(MODEL_DIR, { intermediates: true });
    });

    it('does not create directory when it already exists', async () => {
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
      const mockDownloadAsync = jest.fn().mockResolvedValue({ status: 200 });
      mockCreateDownloadResumable.mockReturnValue({ downloadAsync: mockDownloadAsync });

      await service.startDownload(jest.fn());

      expect(mockMakeDirectoryAsync).not.toHaveBeenCalled();
    });

    it('sets status to done on successful download', async () => {
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
      });

      await service.startDownload(jest.fn());

      expect(service.status).toBe('done');
    });

    it('sets status to error on non-200 response', async () => {
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ status: 403 }),
      });

      await expect(service.startDownload(jest.fn())).rejects.toThrow(/403/);

      expect(service.status).toBe('error');
      expect(service.error).toContain('403');
    });

    it('calls progress callback with fractional progress', async () => {
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
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
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: jest.fn().mockRejectedValue(new Error('network error')),
      });

      await expect(service.startDownload(jest.fn())).rejects.toThrow('network error');
      expect(service.status).toBe('error');
      expect(service.error).toBe('network error');
    });
  });

  describe('pauseDownload', () => {
    const bigFileInfo = { exists: true, size: 200_000_000 };
    it('pauses and sets status to paused', async () => {
      mockGetInfoAsync.mockResolvedValue(bigFileInfo);
      const mockPauseAsync = jest.fn().mockResolvedValue(undefined);

      // Use a deferred downloadAsync so the download stays in-flight
      let resolveDownload!: (value: any) => void;
      const deferredDownload = new Promise<any>(resolve => { resolveDownload = resolve; });
      const mockDownloadAsync = jest.fn().mockReturnValue(deferredDownload);

      mockCreateDownloadResumable.mockReturnValue({
        downloadAsync: mockDownloadAsync,
        pauseAsync: mockPauseAsync,
      });

      // Start download without awaiting to leave it in 'downloading' state
      const downloadPromise = service.startDownload(jest.fn());

      // Flush enough microtasks for: _ensureModelDir, HEAD fetch, pre-delete
      // getInfoAsync, deleteAsync, createDownloadResumable — roughly a dozen
      // awaits before downloadAsync() is called and hangs on the deferred.
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }

      // Now pause — downloadResumable is set and status is 'downloading'
      await service.pauseDownload();

      expect(mockPauseAsync).toHaveBeenCalled();
      expect(service.status).toBe('paused');

      // Resolve deferred download to clean up the pending promise. The resolved
      // status 200 path runs another getInfoAsync → bigFileInfo → done. But
      // since status was flipped to 'paused' the code doesn't reassign from
      // 'paused' to 'done'; the download promise just completes cleanly.
      resolveDownload({ status: 200 });
      await downloadPromise.catch(() => {});
    });

    it('does nothing when not downloading', async () => {
      await service.pauseDownload(); // no-op
      expect(service.status).toBe('idle');
    });
  });

  describe('retryDownload', () => {
    it('deletes partial file and restarts download', async () => {
      // Simulate a partial file exists; later getInfoAsync calls must return a
      // "big file" so the post-download size gate passes.
      const bigFileInfo = { exists: true, size: 200_000_000 };
      mockGetInfoAsync
        .mockResolvedValueOnce({ exists: true }) // retry's pre-delete check
        .mockResolvedValueOnce({ exists: true }) // _ensureModelDir in startDownload
        .mockResolvedValueOnce({ exists: false }) // pre-download stale-file check
        .mockResolvedValueOnce(bigFileInfo); // post-download size check

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
