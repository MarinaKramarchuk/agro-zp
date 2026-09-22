const BASE = '/api';

/** Помилка API з полями status/details (details — список полів від zod). */
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      data?.error ?? `Помилка ${response.status}`,
      response.status,
      data?.details,
    );
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

/** Завантаження файлів (multipart) — окремо від api.post, бо той завжди шле JSON. */
export async function uploadFiles(path, files) {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);

  const response = await fetch(BASE + path, { method: 'POST', body: formData });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(data?.error ?? `Помилка ${response.status}`, response.status, data?.details);
  }

  return data;
}

/** Складання query-рядка без порожніх значень. */
export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}
