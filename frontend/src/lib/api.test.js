import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, query, uploadFiles } from './api.js';

function mockFetch(response) {
  global.fetch = vi.fn().mockResolvedValue(response);
  return global.fetch;
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

describe('query', () => {
  it('відкидає undefined/null/порожній рядок', () => {
    expect(query({ a: 1, b: undefined, c: null, d: '' })).toBe('?a=1');
  });

  it('порожній обʼєкт -> порожній рядок без "?"', () => {
    expect(query({})).toBe('');
  });

  it('0 та false лишаються (не вважаються "порожніми")', () => {
    expect(query({ a: 0, b: false })).toBe('?a=0&b=false');
  });

  it('кілька параметрів обʼєднуються через "&"', () => {
    expect(query({ date_from: '2026-09-01', date_to: '2026-09-30' })).toBe(
      '?date_from=2026-09-01&date_to=2026-09-30',
    );
  });
});

describe('api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET шле запит на /api+path без тіла', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { items: [] }));
    await api.get('/worklogs');
    expect(fetchMock).toHaveBeenCalledWith('/api/worklogs', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('POST серіалізує тіло в JSON і додає Content-Type', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { id: 1 }));
    await api.post('/worklogs', { employee_id: 5 });
    expect(fetchMock).toHaveBeenCalledWith('/api/worklogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: 5 }),
    });
  });

  it('204 No Content -> null, не намагається парсити JSON', async () => {
    mockFetch({ status: 204, ok: true, json: () => Promise.reject(new Error('не мало викликатись')) });
    await expect(api.del('/worklogs/1')).resolves.toBeNull();
  });

  it('помилка з JSON-тілом -> ApiError з message/status/details', async () => {
    mockFetch(jsonResponse(422, { error: 'Помилка валідації', details: [{ path: 'tons', message: 'обовʼязкове' }] }));
    await expect(api.post('/worklogs', {})).rejects.toMatchObject({
      name: 'Error',
      message: 'Помилка валідації',
      status: 422,
      details: [{ path: 'tons', message: 'обовʼязкове' }],
    });
    await expect(api.post('/worklogs', {})).rejects.toBeInstanceOf(ApiError);
  });

  it('помилка без JSON-тіла (напр. HTML від проксі) -> запасне повідомлення "Помилка <статус>"', async () => {
    mockFetch({ status: 502, ok: false, json: () => Promise.reject(new Error('not json')) });
    await expect(api.get('/worklogs')).rejects.toMatchObject({ message: 'Помилка 502', status: 502 });
  });
});

describe('uploadFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('шле файли як multipart FormData під ключем "files"', async () => {
    const fetchMock = mockFetch(jsonResponse(200, { imported: 1 }));
    const file = new File(['вміст'], 'звіт.xlsx');

    await uploadFiles('/overseer/import', [file]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/overseer/import');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.getAll('files')).toEqual([file]);
  });

  it('помилка сервера -> ApiError', async () => {
    mockFetch(jsonResponse(400, { error: 'Немаплена техніка' }));
    await expect(uploadFiles('/overseer/import', [])).rejects.toMatchObject({
      message: 'Немаплена техніка',
      status: 400,
    });
  });
});
