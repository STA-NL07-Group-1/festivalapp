// Foto's en video's in de chat en het album: kiezen, uploaden (met voortgang) en tonen.
// De bestanden zijn privé (alleen de twee vrienden of de groep), dus de app haalt ze op met het
// access-token en toont ze via een blob-URL uit het geheugen.
import { useEffect, useState } from 'react'
import { postWithProgress, requestBlob, type Photo } from '../api/client'

/** Grens van de server (25 MB per bestand) */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

/** Wat de server accepteert. Een iPhone zet een HEIC-foto bij het kiezen zelf om naar jpeg. */
export const ACCEPTED_MEDIA = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm'

export type MediaTarget = { friendId: string } | { groupId: string }

export const isVideo = (type: string | null | undefined) => Boolean(type?.startsWith('video/'))

/** Waarom dit bestand niet kan, of null als het goed is */
export function mediaProblem(file: File): 'tooBig' | 'type' | null {
  if (file.size > MAX_MEDIA_BYTES) return 'tooBig'
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return 'type'
  return null
}

/** Bestand naar base64 (zonder het "data:...;base64,"-begin), zoals POST /photos het wil */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('lezen mislukt'))
    reader.readAsDataURL(file)
  })
}

/** Uploadt naar het album van een vriend of groep. `onProgress` krijgt een getal van 0 tot 1. */
export async function uploadMedia(file: File, target: MediaTarget, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Photo> {
  const image = await toBase64(file)
  return postWithProgress<Photo>('/photos', { image, ...target }, onProgress, signal)
}

// Eén keer ophalen per foto zolang de app open is. Video's niet bewaren: die zijn groot en worden alleen
// opgehaald als je ze afspeelt (zie useMediaUrl met keep = false).
const cache = new Map<string, Promise<string>>()

function fetchMedia(photoId: string, keep: boolean): Promise<string> {
  const cached = cache.get(photoId)
  if (cached) return cached
  const promise = requestBlob(`/photos/${photoId}`).then((blob) => URL.createObjectURL(blob))
  if (keep) {
    cache.set(photoId, promise)
    // Mislukt (bijv. geen bereik)? Dan de volgende keer opnieuw proberen
    promise.catch(() => cache.delete(photoId))
  }
  return promise
}

/** Weg uit het geheugen (na verwijderen) */
export function forgetMedia(photoId: string): void {
  void cache.get(photoId)?.then((url) => URL.revokeObjectURL(url))
  cache.delete(photoId)
}

/**
 * Blob-URL van een foto of video, of null zolang hij laadt. `failed` als het niet lukte.
 * `keep`: in het geheugen houden (foto's). Een video wordt na het sluiten weer vrijgegeven.
 */
export function useMediaUrl(photoId: string | null, keep = true): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; failed: boolean }>({ id: null, url: null, failed: false })
  useEffect(() => {
    if (!photoId) return
    let cancelled = false
    let owned: string | null = null
    fetchMedia(photoId, keep).then(
      (url) => {
        if (!keep) owned = url
        if (cancelled) {
          if (owned) URL.revokeObjectURL(owned)
          return
        }
        setState({ id: photoId, url, failed: false })
      },
      () => {
        if (!cancelled) setState({ id: photoId, url: null, failed: true })
      },
    )
    return () => {
      cancelled = true
      if (owned) URL.revokeObjectURL(owned)
    }
  }, [photoId, keep])
  // Hoort de URL nog bij deze foto? (bij wisselen van foto niet even de vorige tonen)
  return state.id === photoId ? { url: state.url, failed: state.failed } : { url: null, failed: false }
}
