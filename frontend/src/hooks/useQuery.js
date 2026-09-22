import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Завантаження даних з API. path=null — запит не виконується.
 * reload() перезавантажує вручну (після збереження/видалення).
 */
export function useQuery(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });

  const load = useCallback(
    async (signal) => {
      if (!path) {
        setState({ data: null, error: null, loading: false });
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await api.get(path);
        if (!signal?.aborted) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!signal?.aborted) setState({ data: null, error, loading: false });
      }
    },
    [path],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { ...state, reload: () => load() };
}
