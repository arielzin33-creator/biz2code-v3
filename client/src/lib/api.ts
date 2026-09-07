

const BASE = import.meta.env.VITE_API_URL ?? '/api';   


export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }


  get isUnauthenticated() { return this.status === 401; }

  get isRefusedByGate() { return this.status === 409; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',                       
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new ApiError(body.error ?? res.statusText ?? 'Request failed', res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => api<T>(path);

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });


export const downloadUrl = (projectId: number, documentId: number) =>
  `${BASE}/projects/${projectId}/documents/${documentId}/download`;
