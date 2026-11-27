import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type GroupDetail, type Message } from '../api/client'
import { BackIcon, BellOffIcon, GroupIcon, SendIcon } from '../components/icons'
import { MediaComposer, MediaThumb, MediaViewer, type MediaItem } from '../components/media'
import { Avatar, Empty, ErrorNote, Skeleton } from '../components/ui'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/format'
import type { Conversation } from '../lib/conversation'
import { forgetMedia, isVideo } from '../lib/media'
import { isMuted, muteLabel } from '../lib/mute'
import { refreshUnread } from '../lib/unread'
import { systemText } from '../lib/systemText'
import { deliver, enqueue, enqueueGroup, flushOutbox, isMessageItem, removeFromOutbox, useOutbox, type MessageItem } from '../lib/outbox'
import { useAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'
import { FriendInfoSheet } from './FriendInfo'
import { GroupInfoSheet } from './GroupScreens'

export function ChatScreen({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const { t, locale } = useI18n()
  const { me, online } = useSession()
  const isGroup = conversation.type === 'group'
  const id = isGroup ? conversation.group.id : conversation.friend.id
  const basePath = isGroup ? `/groups/${id}/messages` : `/messages/${id}`
  const messages = useAsync(() => api.get<Message[]>(`${basePath}?limit=100`), [basePath])
  // Leden van de groep (voor namen bij berichten en de groepsinfo)
  const group = useAsync(() => (isGroup ? api.get<GroupDetail>(`/groups/${id}`) : Promise.resolve(null)), [isGroup, id])
  const [text, setText] = useState('')
  // Berichten in de wachtrij (lib/outbox.ts): staan meteen op het scherm, ook na het sluiten van de app
  const outbox = useOutbox()
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [rejected, setRejected] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [viewing, setViewing] = useState<MediaItem | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  // Gedempt? Eerst uit de lijst waar je vandaan kwam; daarna bijgewerkt door de groepsinfo, het profiel
  // of je andere apparaten (realtime-event chat.muted)
  const [mutedUntil, setMutedUntil] = useState<string | null>(isGroup ? conversation.group.mutedUntil : conversation.friend.mutedUntil)
  const [groupMuteSeen, setGroupMuteSeen] = useState<string | null | undefined>(undefined)
  if (group.data && group.data.mutedUntil !== groupMuteSeen) {
    setGroupMuteSeen(group.data.mutedUntil)
    setMutedUntil(group.data.mutedUntil)
  }
  useRealtime<{ friendId?: string; groupId?: string; mutedUntil: string | null }>(
    'chat.muted',
    useCallback((e) => (isGroup ? e.groupId === id : e.friendId === id) && setMutedUntil(e.mutedUntil), [isGroup, id]),
  )

  const title = isGroup ? (group.data?.name ?? conversation.group.name) : conversation.friend.displayName
  const nameOf = (userId: string) =>
    userId === me?.id
      ? t('chat.you')
      : isGroup
        ? (group.data?.members.find((m) => m.id === userId)?.displayName ?? t('chat.formerMember'))
        : conversation.friend.displayName

  const setMessages = messages.setData
  const addMessage = useCallback(
    (m: Message) => setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [m, ...(list ?? [])])),
    [setMessages],
  )
  const belongsHere = useCallback(
    (m: Message) =>
      isGroup
        ? m.groupId === id
        : (m.senderId === id && m.recipientId === me?.id) || (m.senderId === me?.id && m.recipientId === id),
    [isGroup, id, me?.id],
  )
  const readPath = isGroup ? `/groups/${id}/read` : `/messages/${id}/read`
  const onMessage = useCallback(
    (m: Message) => {
      if (!belongsHere(m)) return
      addMessage(m)
      // Eigen bericht via de WebSocket eerder binnen dan het antwoord op de POST: uit de wachtrij halen
      if (m.senderId === me?.id && m.clientId) removeFromOutbox(m.clientId)
      // Je ziet het bericht nu: gelezen (alleen als de app echt in beeld is)
      else if (m.senderId !== me?.id && document.visibilityState === 'visible') {
        void api.post(readPath).then(refreshUnread, () => {})
      }
    },
    [belongsHere, addMessage, me?.id, readPath],
  )
  useRealtime<Message>(isGroup ? 'group.message' : 'chat.message', onMessage)

  // Groep veranderd (naam, leden) of jij bent eruit
  const reloadGroup = group.reload
  useRealtime<{ groupId: string }>(
    'group.updated',
    useCallback(({ groupId }) => groupId === id && void reloadGroup(), [id, reloadGroup]),
  )
  useRealtime<{ groupId: string }>(
    'group.removed',
    useCallback(({ groupId }) => groupId === id && onBack(), [id, onBack]),
  )

  // Weer bereik (of de chat net geopend): wat nog in de wachtrij staat alsnog versturen
  const reload = messages.reload
  useEffect(() => {
    if (online) void flushOutbox().then(() => reload())
  }, [online, reload])

  // Het gesprek ophalen markeert alles als gelezen (zie de API): het getal op het app-icoon bijwerken
  useEffect(() => {
    if (messages.data) refreshUnread()
  }, [messages.data])

  // De API geeft nieuwste eerst; we tonen oudste bovenaan
  const ordered = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data])
  const pending = useMemo(() => {
    const sent = new Set(ordered.map((m) => m.clientId).filter(Boolean))
    return outbox
      .filter(isMessageItem)
      .filter((item) => (isGroup ? item.groupId === id : !item.groupId && item.friendId === id) && !sent.has(item.clientId))
  }, [outbox, ordered, isGroup, id])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.data, pending.length])

  async function send(item: MessageItem) {
    setFailed((set) => new Set([...set].filter((x) => x !== item.clientId)))
    setRejected(false)
    try {
      addMessage(await deliver(item))
    } catch (error) {
      // 400/404: de server weigert het voorgoed (het staat dan ook niet meer in de wachtrij)
      if (error instanceof ApiError && (error.status === 400 || error.status === 404)) setRejected(true)
      else setFailed((set) => new Set(set).add(item.clientId))
    }
  }

  // Optimistic update: het bericht staat meteen op het scherm en wordt vol zodra de server het heeft
  function submit(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    void send(isGroup ? enqueueGroup(id, body) : enqueue(id, body))
  }

  // Foto of video: eerst geüpload door MediaComposer, dan het bericht met photoId
  async function sendMedia(photoId: string, caption: string) {
    const message = await api.post<Message>(basePath, { photoId, ...(caption ? { body: caption } : {}), clientId: crypto.randomUUID() })
    addMessage(message)
  }

  async function deleteMedia(item: MediaItem) {
    await api.delete(`/photos/${item.photoId}`)
    forgetMedia(item.photoId)
    // Het bericht blijft staan, zonder foto (zoals op de server)
    setMessages((list) => list?.map((m) => (m.photoId === item.photoId ? { ...m, photoId: null, mediaType: null } : m)))
  }

  const status = (item: MessageItem) => {
    if (failed.has(item.clientId)) {
      return (
        <button type="button" className="bubble-retry" onClick={() => void send(item)}>
          {online ? `${t('chat.failed')} · ${t('chat.retry')}` : t('chat.waiting')}
        </button>
      )
    }
    return <span className="bubble-status">{online ? t('chat.sending') : t('chat.waiting')}</span>
  }

  return (
    <section className="chat" aria-label={`${t('friends.chat')} ${title}`}>
      <header className="chat-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label={t('common.back')}>
          <BackIcon />
        </button>
        {/* Tik op de naam: profiel met gedeelde media, of de groepsinfo met leden */}
        <button type="button" className="chat-title" onClick={() => setInfoOpen(true)} aria-label={isGroup ? t('group.info') : t('chat.profile')}>
          {isGroup ? (
            <span className="avatar group-avatar" aria-hidden="true">
              <GroupIcon />
            </span>
          ) : (
            <Avatar name={title} size={36} />
          )}
          <span className="chat-title-text">
            <h1>
              {title}
              {isMuted(mutedUntil) && (
                <>
                  <BellOffIcon className="muted-icon" />
                  <span className="visually-hidden">{muteLabel(mutedUntil, t, locale)}</span>
                </>
              )}
            </h1>
            {isGroup && group.data && <small className="muted">{t('group.members', { count: group.data.members.length })}</small>}
          </span>
        </button>
      </header>
      <div className="chat-messages" aria-live="polite">
        {messages.loading && <Skeleton variant="bubble" rows={4} />}
        {!messages.loading && ordered.length === 0 && pending.length === 0 && <Empty icon={<SendIcon />}>{t('chat.empty')}</Empty>}
        {ordered.map((m) => {
          if (m.kind === 'systeem' && m.systemEvent) {
            return (
              <p key={m.id} className="chat-system">
                {systemText(m.systemEvent, me?.id ?? null, t)}
              </p>
            )
          }
          const mine = m.senderId === me?.id
          return (
            <div key={m.id} className={`bubble ${mine ? 'mine' : 'theirs'} ${m.kind === 'foto' ? 'media' : ''}`}>
              {isGroup && !mine && <span className="bubble-sender">{nameOf(m.senderId)}</span>}
              {m.kind === 'foto' &&
                (m.photoId ? (
                  <MediaThumb
                    photoId={m.photoId}
                    mediaType={m.mediaType}
                    label={isVideo(m.mediaType) ? t('media.openVideo') : t('media.openPhoto')}
                    onOpen={() =>
                      setViewing({ photoId: m.photoId!, mediaType: m.mediaType, caption: m.body, by: nameOf(m.senderId), createdAt: m.createdAt, mine })
                    }
                  />
                ) : (
                  <p className="muted small">{t('media.removed')}</p>
                ))}
              {/* Platte tekst: React escapet dit, er wordt nooit HTML uitgevoerd */}
              {m.body && <p>{m.body}</p>}
              <time dateTime={m.createdAt}>{formatTime(m.createdAt, locale)}</time>
            </div>
          )
        })}
        {pending.map((item) => (
          <div key={item.clientId} className={`bubble mine ${failed.has(item.clientId) && online ? 'failed' : 'sending'}`}>
            <p>{item.body}</p>
            {status(item)}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {rejected && <ErrorNote>{t('chat.rejected')}</ErrorNote>}
      <form className="chat-input" onSubmit={submit}>
        <MediaComposer target={isGroup ? { groupId: id } : { friendId: id }} online={online} send={sendMedia} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={1000}
          aria-label={t('chat.placeholder')}
          enterKeyHint="send"
        />
        <button className="icon-button primary" aria-label={t('chat.send')} disabled={!text.trim()}>
          <SendIcon />
        </button>
      </form>

      <MediaViewer item={viewing} onClose={() => setViewing(null)} onDelete={deleteMedia} />
      {isGroup ? (
        <GroupInfoSheet
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          group={group.data ? { ...group.data, mutedUntil } : null}
          onChanged={() => void reloadGroup()}
          onMuteChanged={setMutedUntil}
          onLeft={onBack}
        />
      ) : (
        <FriendInfoSheet
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          friend={{ ...conversation.friend, mutedUntil }}
          onMuteChanged={setMutedUntil}
        />
      )}
    </section>
  )
}
