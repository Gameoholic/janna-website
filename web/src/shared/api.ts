export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NETWORK_MESSAGE = 'Нет связи. Проверьте интернет и попробуйте ещё раз.';
const GENERIC_MESSAGE = 'Произошла ошибка. Попробуйте ещё раз.';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) {
    let message = GENERIC_MESSAGE;
    try {
      const data = await res.json();
      if (data && typeof data.message === 'string') message = data.message;
    } catch { /* keep generic */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export interface UploadHandle {
  promise: Promise<unknown>;
  abort: () => void;
}

/** XHR upload with progress — the progress bar is not optional (Section 9). */
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (fraction: number) => void
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const message =
          xhr.response && typeof xhr.response.message === 'string' ? xhr.response.message : GENERIC_MESSAGE;
        reject(new ApiError(xhr.status, message));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, NETWORK_MESSAGE));
    xhr.onabort = () => reject(new ApiError(0, 'Загрузка отменена.'));
    xhr.send(formData);
  });
  return { promise, abort: () => xhr.abort() };
}

// Cloudflare Tunnel enforces a hard ~100MB cap per HTTP request at its edge —
// no origin-side setting can raise it. Anything at or above this goes through
// uploadLarge() instead, comfortably under that cap per chunk.
export const LARGE_FILE_THRESHOLD = 80 * 1024 * 1024;

interface InitUploadResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

function sendChunk(url: string, blob: Blob, onLoaded: (loaded: number) => void): { promise: Promise<void>; xhr: XMLHttpRequest } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onLoaded(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, GENERIC_MESSAGE));
    };
    xhr.onerror = () => reject(new ApiError(0, NETWORK_MESSAGE));
    xhr.onabort = () => reject(new ApiError(0, 'Загрузка отменена.'));
    xhr.send(blob);
  });
  return { promise, xhr };
}

/**
 * Uploads a file too large for one request in chunks, then calls completeUrl
 * with { uploadId } to reassemble + register it — completeUrl's response is
 * returned as-is, matching what the direct multipart endpoints return.
 */
export function uploadLarge(completeUrl: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  let aborted = false;
  let currentXhr: XMLHttpRequest | null = null;
  const promise = (async () => {
    const init = await request<InitUploadResponse>('POST', '/api/uploads/init', { name: file.name, size: file.size });
    for (let i = 0; i < init.totalChunks; i++) {
      if (aborted) throw new ApiError(0, 'Загрузка отменена.');
      const start = i * init.chunkSize;
      const blob = file.slice(start, Math.min(start + init.chunkSize, file.size));
      const { promise: chunkPromise, xhr } = sendChunk(`/api/uploads/${init.uploadId}/chunk/${i}`, blob, (loaded) =>
        onProgress((start + loaded) / file.size)
      );
      currentXhr = xhr;
      await chunkPromise;
    }
    currentXhr = null;
    return request('POST', completeUrl, { uploadId: init.uploadId });
  })();
  return {
    promise,
    abort: () => {
      aborted = true;
      currentXhr?.abort();
    },
  };
}

// ---- Shared API types ----

export interface FolderInfo {
  id: string;
  name: string;
  fileCount: number;
}

export interface FileInfo {
  id: string;
  folderId: string | null;
  name: string;
  kind: 'video' | 'image' | 'audio' | 'other';
  mime: string;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  origin: string;
  createdAt: number;
}

export interface StorageState {
  folders: FolderInfo[];
  rootFileCount: number;
}

export interface PathPart {
  id: string;
  name: string;
}

export interface ReminderInfo {
  id: string;
  text: string;
  dueAt: number;
  status: 'scheduled' | 'ringing' | 'snoozed';
  snoozeUntil: number | null;
  snoozeUsed: boolean;
  createdAt: number;
}

export interface EditSessionInfo {
  id: string;
  name: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export interface EditJobInfo {
  id: string;
  sessionId: string;
  state: 'running' | 'done' | 'error';
  progress: number;
  outputName: string;
  durationMs: number | null;
  error: string | null;
  savedFileId: string | null;
}

export interface ActiveAlarm {
  id: string;
  text: string;
  dueAt: number;
  time: string;
  date: string;
  snoozeUsed: boolean;
}
