import { useCallback, useEffect, useRef, useState } from 'react'

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
