import { useCallback, useEffect, useRef, useState } from 'react'
import { loadOffline, saveOffline } from './offlineStore'

/**
 * Haalt data op zodra het component verschijnt of `deps` veranderen.
 * Geeft { data, error, loading, reload, setData } terug.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const loadRef = useRef(load)
  const key = JSON.stringify(deps)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    loadRef.current().then(
      (result) => {
        if (cancelled) return
        setData(result)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e)
      },
    )
    return () => {
      cancelled = true
    }
  }, [key])

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  return { data, error, loading: data === undefined && error === null, reload, setData }
}

/**
 * Zoals useAsync, maar bewaart het resultaat op de telefoon. Zonder internet krijg je
 * de laatst bewaarde gegevens terug, met `savedAt` (wanneer ze van de server kwamen)
 * en `fromCache` = true.
 */
export function useOfflineAsync<T>(cacheKey: string, load: () => Promise<T>) {
  const [initial] = useState(() => loadOffline<T>(cacheKey))
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null)
  const [fromCache, setFromCache] = useState(initial !== null)
  const result = useAsync(async () => {
    try {
      const fresh = await load()
      saveOffline(cacheKey, fresh)
      setSavedAt(new Date().toISOString())
      setFromCache(false)
      return fresh
    } catch (error) {
      const stored = loadOffline<T>(cacheKey)
      if (!stored) throw error
      setSavedAt(stored.savedAt)
      setFromCache(true)
      return stored.data
    }
  }, [cacheKey])

  const { setData } = result
  // Live updates (bijv. via de WebSocket) ook bewaren, zodat ze offline zichtbaar blijven
  const setAndStore = useCallback(
    (update: T | undefined | ((current: T | undefined) => T | undefined)) => {
      setData((current) => {
        const next = typeof update === 'function' ? (update as (c: T | undefined) => T | undefined)(current) : update
        if (next !== undefined) saveOffline(cacheKey, next)
        return next
      })
    },
    [cacheKey, setData],
  )

  return {
    ...result,
    data: result.data ?? initial?.data,
    // Met bewaarde gegevens is er meteen iets te tonen, ook als de server nog niet heeft geantwoord
    loading: result.loading && initial === null,
    setData: setAndStore,
    savedAt,
    fromCache,
  }
}
