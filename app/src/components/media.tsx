// Foto's en video's: miniatuur, groot bekijken, een raster (album) en de + knop in de chat.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError, type Photo } from '../api/client'
import { useI18n } from '../i18n'
import { formatRelative } from '../lib/format'
import { ACCEPTED_MEDIA, isVideo, mediaProblem, uploadMedia, useMediaUrl, type MediaTarget } from '../lib/media'
import { ImageIcon, PlayIcon, PlusIcon } from './icons'
import { ErrorNote, Sheet } from './ui'

/** Wat je groot bekijkt: uit de chat of uit het album */
export interface MediaItem {
  photoId: string
  mediaType: string | null
  caption?: string | null
  /** Naam van wie het deelde */
  by?: string
  createdAt?: string
  /** Eigen foto of video: dan kun je hem weghalen */
  mine?: boolean
}

/**
 * Kleine weergave. Een foto wordt opgehaald; een video niet (die kan 25 MB zijn): die krijgt een vlak
 * met een afspeelknop, en wordt pas opgehaald als je hem opent.
 */
export function MediaThumb({ photoId, mediaType, label, onOpen }: { photoId: string; mediaType: string | null; label: string; onOpen: () => void }) {
  const video = isVideo(mediaType)
  const { url, failed } = useMediaUrl(video ? null : photoId)
  return (
    <button type="button" className={`media-thumb ${video ? 'video' : ''}`} onClick={onOpen} aria-label={label}>
      {video ? (
        <span className="media-play" aria-hidden="true">
          <PlayIcon />
        </span>
      ) : url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={`media-placeholder ${failed ? 'failed' : ''}`} aria-hidden="true">
          <ImageIcon />
        </span>
      )}
    </button>
  )
}

/** Raster van foto's en video's (album van een vriend of groep) */
export function MediaGrid({ photos, onOpen }: { photos: Photo[]; onOpen: (photo: Photo) => void }) {
  const { t } = useI18n()
  return (
    <div className="media-grid">
      {photos.map((p) => (
        <MediaThumb
          key={p.id}
          photoId={p.id}
          mediaType={p.contentType}
          label={isVideo(p.contentType) ? t('media.openVideo') : t('media.openPhoto')}
          onOpen={() => onOpen(p)}
        />
      ))}
    </div>
  )
}

/** Groot bekijken, in een venster dat je omlaag kunt vegen. Een video speelt af in de app. */
export function MediaViewer({ item, onClose, onDelete }: { item: MediaItem | null; onClose: () => void; onDelete?: (item: MediaItem) => Promise<void> }) {
  const { t, locale } = useI18n()
  const video = isVideo(item?.mediaType)
  // Video's niet bewaren in het geheugen: na sluiten weer vrijgeven
  const { url, failed } = useMediaUrl(item?.photoId ?? null, !video)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(false)

  async function remove() {
    if (!item || !onDelete || !window.confirm(t('media.deleteConfirm'))) return
    setDeleting(true)
    setError(false)
    try {
      await onDelete(item)
      onClose()
    } catch {
      setError(true)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={item !== null} onClose={onClose} title={video ? t('media.video') : t('media.photo')}>
      {item && (
        <div className="media-viewer">
          {url ? (
            video ? (
              <video src={url} controls playsInline autoPlay className="media-full" />
            ) : (
              <img src={url} alt={item.caption ?? ''} className="media-full" />
            )
          ) : failed ? (
            <ErrorNote>{t('media.loadFailed')}</ErrorNote>
          ) : (
            <div className="media-loading" role="status">
              {t('common.loading')}
            </div>
          )}
          {item.caption && <p>{item.caption}</p>}
          {(item.by || item.createdAt) && (
            <p className="muted small">
              {[item.by, item.createdAt ? formatRelative(item.createdAt, locale) : null].filter(Boolean).join(' · ')}
            </p>
          )}
          {error && <ErrorNote>{t('common.error')}</ErrorNote>}
          {item.mine && onDelete && (
            <button type="button" className="button danger-outline" disabled={deleting} onClick={() => void remove()}>
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}

/**
 * De + knop naast de verzendknop: foto of video kiezen (camera of bibliotheek), voorbeeld met een
 * bijschrift, en versturen met een voortgangsbalk. `send` maakt het chatbericht met de geüploade foto.
 */
export function MediaComposer({ target, online, send }: { target: MediaTarget; online: boolean; send: (photoId: string, caption: string) => Promise<void> }) {
  const { t } = useI18n()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  // Voorbeeld-URL opruimen als het venster weggaat of de chat sluit
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function choose(chosen: File | undefined) {
    if (input.current) input.current.value = ''
    if (!chosen) return
    const problem = mediaProblem(chosen)
    setError(problem === 'tooBig' ? t('media.tooBig') : problem === 'type' ? t('media.wrongType') : null)
    if (problem) {
      setFile(null)
      return
    }
    setCaption('')
    setProgress(null)
    setFile(chosen)
    setPreview(URL.createObjectURL(chosen))
  }

  function close() {
    abort.current?.abort()
    setFile(null)
    setPreview(null)
    setProgress(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Dit venster staat (via een portal) binnen het tekstformulier van de chat. Zonder stopPropagation
    // gaat de submit in React ook naar dat formulier, en dan zou getypte tekst mee verstuurd worden.
    event.stopPropagation()
    if (!file) return
    setError(null)
    setProgress(0)
    const controller = new AbortController()
    abort.current = controller
    try {
      const photo = await uploadMedia(file, target, setProgress, controller.signal)
      await send(photo.id, caption.trim())
      close()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'aborted') return
      setProgress(null)
      if (e instanceof ApiError && e.status === 0) setError(t('media.offline'))
      else if (e instanceof ApiError && (e.status === 400 || e.status === 413)) setError(t('media.rejected'))
      else setError(t('common.error'))
    }
  }

  const video = file?.type.startsWith('video/') ?? false
  const sending = progress !== null
  // Alleen een blob:-adres dat we zelf met createObjectURL maakten, nooit iets anders uit het bestand
  // (CodeQL: "DOM text reinterpreted as HTML"). Een blob-URL kan geen script uitvoeren.
  const safePreview = preview?.startsWith('blob:') ? preview : null

  return (
    <>
      <label htmlFor={inputId} className="icon-button attach" aria-label={t('media.add')} title={t('media.add')}>
        <PlusIcon />
      </label>
      <input
        id={inputId}
        ref={input}
        type="file"
        accept={ACCEPTED_MEDIA}
        className="visually-hidden"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      {error && !file && (
        <p className="chat-media-error" role="alert">
          {error}
        </p>
      )}
      <Sheet open={file !== null} onClose={close} title={video ? t('media.sendVideo') : t('media.sendPhoto')}>
        <form className="form" onSubmit={(e) => void submit(e)}>
          {safePreview &&
            (video ? (
              <video src={safePreview} controls playsInline muted className="media-preview" />
            ) : (
              <img src={safePreview} alt="" className="media-preview" />
            ))}
          <label>
            {t('media.caption')}
            <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} disabled={sending} />
          </label>
          {sending && (
            <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
              <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              <small>{progress !== null && progress >= 1 ? t('media.processing') : t('media.uploading', { percent: Math.round((progress ?? 0) * 100) })}</small>
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {!online && <p className="muted small">{t('media.offline')}</p>}
          <button className="button primary" disabled={sending || !online}>
            {t('chat.send')}
          </button>
        </form>
      </Sheet>
    </>
  )
}
