import { useCallback, useEffect, useRef, useState } from 'react';
import { dataSource } from '../api';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  reload: () => void;
}

/**
 * Lädt Daten aus der Datenquelle und lädt automatisch neu, wenn die
 * Datenquelle eine Änderung meldet (z. B. Alarm bestätigt, Aktualisieren).
 *
 * @param loader  Funktion, die die Datenquelle abfragt
 * @param deps    Abhängigkeiten, bei deren Änderung neu geladen wird
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => dataSource.subscribe(reload), [reload]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return { data, loading, error, reload };
}
