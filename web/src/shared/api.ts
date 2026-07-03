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
