// Gedeelde foto's en video's: het album met een vriend of van een groep (GET /photos).
import { useState } from 'react'
import { api, type Photo } from '../api/client'
import { useI18n } from '../i18n'
import { forgetMedia, type MediaTarget } from '../lib/media'
import { useAsync } from '../lib/useAsync'
import { useSession } from '../state/session'
import { ImageIcon } from './icons'
import { MediaGrid, MediaViewer, type MediaItem } from './media'
import { Empty, Skeleton } from './ui'

const PAGE = 50
/** Zoveel op het profiel; de rest achter "Alles bekijken" */
const PREVIEW = 6

export function SharedMedia({ target, names }: { target: MediaTarget; names: (userId: string) => string }) {
  const { t } = useI18n()
  const { me } = useSession()
  const query = 'friendId' in target ? `friendId=${target.friendId}` : `groupId=${target.groupId}`
  const photos = useAsync(() => api.get<Photo[]>(`/photos?${query}&limit=${PAGE}`), [query])
  const [all, setAll] = useState(false)
  const [more, setMore] = useState(true)
  const [viewing, setViewing] = useState<MediaItem | null>(null)

  const list = photos.data ?? []
  const shown = all ? list : list.slice(0, PREVIEW)

  async function loadMore() {
    const last = list.at(-1)
    if (!last) return
    const next = await api.get<Photo[]>(`/photos?${query}&limit=${PAGE}&before=${encodeURIComponent(last.createdAt)}`)
    if (next.length < PAGE) setMore(false)
    photos.setData((current) => [...(current ?? []), ...next.filter((p) => !current?.some((c) => c.id === p.id))])
  }

  async function remove(item: MediaItem) {
    await api.delete(`/photos/${item.photoId}`)
    forgetMedia(item.photoId)
    photos.setData((current) => current?.filter((p) => p.id !== item.photoId))
  }

  return (
    <section className="shared-media" aria-labelledby="shared-media-title">
      <div className="shared-media-head">
        <h3 id="shared-media-title">{t('media.shared')}</h3>
        {!all && list.length > PREVIEW && (
          <button type="button" className="link" onClick={() => setAll(true)}>
            {t('media.showAll', { count: list.length >= PAGE ? `${PAGE}+` : list.length })}
          </button>
        )}
      </div>
      {photos.loading && <Skeleton variant="card" rows={1} />}
      {photos.data?.length === 0 && <Empty icon={<ImageIcon />}>{t('media.noneShared')}</Empty>}
      <MediaGrid
        photos={shown}
        onOpen={(p) =>
          setViewing({ photoId: p.id, mediaType: p.contentType, caption: p.caption, by: names(p.uploadedBy), createdAt: p.createdAt, mine: p.uploadedBy === me?.id })
        }
      />
      {all && more && list.length >= PAGE && (
        <button type="button" className="button small" onClick={() => void loadMore()}>
          {t('media.loadMore')}
        </button>
      )}
      <MediaViewer item={viewing} onClose={() => setViewing(null)} onDelete={remove} />
    </section>
  )
}
