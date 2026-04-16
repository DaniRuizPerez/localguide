/**
 * Characterization: ModelDownloadService state machine
 *
 * Locks in the full status-transition sequence so refactor PRs can't
 * accidentally regress the download lifecycle.  Complements the more
 * exhaustive unit tests in ModelDownloadService.test.ts by focusing on
 * observable state at each transition point.
 */

import { ModelDownloadService, MODEL_LOCAL_PATH } from '../services/ModelDownloadService';

// ── Mock expo-file-system ──────────────────────────────────────────────────
const mockGetInfoAsync = jest.fn();
const mockMakeDirectoryAsync = jest.fn().mockResolvedValue(undefined);
const mockDeleteAsync = jest.fn().mockResolvedValue(undefined);
const mockCreateDownloadResumable = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.localguideapp/files/',
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectoryAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
  createDownloadResumable: (...args: unknown[]) => mockCreateDownloadResumable(...args),
}));

global.fetch = jest.fn();

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDownloadResumable(opts: {
  resolve?: (v: { status: number }) => void;
  reject?: (e: Error) => void;
  onPause?: () => void;
} = {}) {
  let externalResolve: (v: { status: number }) => void;
  let externalReject: (e: Error) => void;
  const downloadPromise = new Promise<{ status: number }>((res, rej) => {
    externalResolve = opts.resolve ? (v) => { opts.resolve!(v); res(v); } : res;
    externalReject = opts.reject ? (e) => { opts.reject!(e); rej(e); } : rej;
  });

  return {
    mock: {
      downloadAsync: jest.fn().mockReturnValue(downloadPromise),
      pauseAsync: jest.fn().mockImplementation(async () => { opts.onPause?.(); }),
      resumeAsync: jest.fn().mockResolvedValue({ status: 200 }),
    },
    resolve: (v: { status: number }) => externalResolve(v),
    reject: (e: Error) => externalReject(e),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Characterization: ModelDownloadService — initial state', () => {
  it('starts with status idle', () => {
    const svc = new ModelDownloadService();
    expect(svc.status).toBe('idle');
  });

  it('starts with error null', () => {
    const svc = new ModelDownloadService();
    expect(svc.error).toBeNull();
  });
});

describe('Characterization: ModelDownloadService — download lifecycle', () => {
  let svc: ModelDownloadService;

  beforeEach(() => {
    svc = new ModelDownloadService();
    jest.clearAllMocks();
    mockMakeDirectoryAsync.mockResolvedValue(undefined);
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  it('status transitions: idle → done on successful download', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });

    expect(svc.status).toBe('idle');
    await svc.startDownload(jest.fn());
    expect(svc.status).toBe('done');
  });

  it('status transitions: idle → error on non-200 response', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: jest.fn().mockResolvedValue({ status: 403 }),
    });

    await svc.startDownload(jest.fn());
    expect(svc.status).toBe('error');
    expect(svc.error).toContain('403');
  });

  it('status transitions: idle → error on network throw', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });
    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: jest.fn().mockRejectedValue(new Error('network error')),
    });

    await expect(svc.startDownload(jest.fn())).rejects.toThrow('network error');
    expect(svc.status).toBe('error');
    expect(svc.error).toBe('network error');
  });

  it('status transitions: downloading → paused after pauseDownload()', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });

    let resolveDownload!: (v: { status: number }) => void;
    const downloadPromise = new Promise<{ status: number }>((res) => { resolveDownload = res; });
    const mockPauseAsync = jest.fn().mockResolvedValue(undefined);

    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: jest.fn().mockReturnValue(downloadPromise),
      pauseAsync: mockPauseAsync,
    });

    const downloadTask = svc.startDownload(jest.fn());
    // Flush microtasks so the download initialises
    await Promise.resolve();
    await Promise.resolve();

    await svc.pauseDownload();
    expect(svc.status).toBe('paused');
    expect(mockPauseAsync).toHaveBeenCalled();

    resolveDownload({ status: 200 });
    await downloadTask;
  });

  it('pauseDownload() is a no-op when not downloading', async () => {
    expect(svc.status).toBe('idle');
    await svc.pauseDownload();
    expect(svc.status).toBe('idle');
  });

  it('retryDownload() deletes partial file then status ends at done', async () => {
    mockGetInfoAsync
      .mockResolvedValueOnce({ exists: true }) // deleteAsync check
      .mockResolvedValueOnce({ exists: true }); // dir check inside startDownload
    mockCreateDownloadResumable.mockReturnValue({
      downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });

    await svc.retryDownload(jest.fn());

    expect(mockDeleteAsync).toHaveBeenCalledWith(MODEL_LOCAL_PATH, { idempotent: true });
    expect(svc.status).toBe('done');
  });

  it('deleteModel() sets status back to idle', async () => {
    await svc.deleteModel();
    expect(mockDeleteAsync).toHaveBeenCalledWith(MODEL_LOCAL_PATH, { idempotent: true });
    expect(svc.status).toBe('idle');
  });
});

describe('Characterization: ModelDownloadService — progress callback contract', () => {
  it('calls onProgress with {bytesDownloaded, bytesTotal, fraction}', async () => {
    const svc = new ModelDownloadService();
    jest.clearAllMocks();
    mockGetInfoAsync.mockResolvedValue({ exists: true });

    let capturedCb: ((p: any) => void) | undefined;
    mockCreateDownloadResumable.mockImplementation(
      (_url: string, _dest: string, _opts: unknown, cb: (p: any) => void) => {
        capturedCb = cb;
        return {
          downloadAsync: jest.fn().mockImplementation(async () => {
            capturedCb!({ totalBytesWritten: 250, totalBytesExpectedToWrite: 1000 });
            return { status: 200 };
          }),
        };
      }
    );

    const onProgress = jest.fn();
    await svc.startDownload(onProgress);

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ bytesDownloaded: 250, bytesTotal: 1000, fraction: 0.25 })
    );
  });
});

describe('Characterization: ModelDownloadService — isModelDownloaded', () => {
  it('returns true when file exists with size > 0', async () => {
    const svc = new ModelDownloadService();
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 500_000_000 });
    await expect(svc.isModelDownloaded()).resolves.toBe(true);
  });

  it('returns false when file does not exist', async () => {
    const svc = new ModelDownloadService();
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    await expect(svc.isModelDownloaded()).resolves.toBe(false);
  });

  it('returns false when file exists with size 0 (partial/corrupt)', async () => {
    const svc = new ModelDownloadService();
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 0 });
    await expect(svc.isModelDownloaded()).resolves.toBe(false);
  });
});
