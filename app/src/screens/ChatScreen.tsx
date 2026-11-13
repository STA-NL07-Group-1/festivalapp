import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type Friend, type Message } from '../api/client'
import { BackIcon, SendIcon } from '../components/icons'
import { Avatar, Empty, ErrorNote, Skeleton } from '../components/ui'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/format'
import { deliver, enqueue, flushOutbox, removeFromOutbox, useOutbox, type OutboxItem } from '../lib/outbox'
import { useAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'

export function ChatScreen({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const { t, locale } = useI18n()
  const { me, online } = useSession()
  const messages = useAsync(() => api.get<Message[]>(`/messages/${friend.id}?limit=100`), [friend.id])
  const [text, setText] = useState('')
  // Berichten in de wachtrij (lib/outbox.ts): staan meteen op het scherm, ook na het sluiten van de app
  const outbox = useOutbox()
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const [rejected, setRejected] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const setMessages = messages.setData
  useRealtime<Message>(
    'chat.message',
    useCallback(
      (m) => {
        const inConversation =
          (m.senderId === friend.id && m.recipientId === me?.id) || (m.senderId === me?.id && m.recipientId === friend.id)
        if (!inConversation) return
        setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [m, ...(list ?? [])]))
        // Eigen bericht via de WebSocket eerder binnen dan het antwoord op de POST: uit de wachtrij halen
        if (m.senderId === me?.id && m.clientId) removeFromOutbox(m.clientId)
      },
      [friend.id, me?.id, setMessages],
    ),
  )

  // Weer bereik (of de chat net geopend): wat nog in de wachtrij staat alsnog versturen
  const reload = messages.reload
  useEffect(() => {
    if (online) void flushOutbox().then(() => reload())
  }, [online, reload])

  // De API geeft nieuwste eerst; we tonen oudste bovenaan
  const ordered = useMemo(() => [...(messages.data ?? [])].reverse(), [messages.data])
  const pending = useMemo(() => {
    const sent = new Set(ordered.map((m) => m.clientId).filter(Boolean))
    return outbox.filter((item) => item.friendId === friend.id && !sent.has(item.clientId))
  }, [outbox, ordered, friend.id])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.data, pending.length])

  async function send(item: OutboxItem) {
    setFailed((set) => new Set([...set].filter((id) => id !== item.clientId)))
    setRejected(false)
    try {
      const message = await deliver(item)
      setMessages((list) => (list?.some((x) => x.id === message.id) ? list : [message, ...(list ?? [])]))
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
    void send(enqueue(friend.id, body))
  }

  const status = (item: OutboxItem) => {
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
    <section className="chat" aria-label={`${t('friends.chat')} ${friend.displayName}`}>
      <header className="chat-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label={t('common.back')}>
          <BackIcon />
        </button>
        <Avatar name={friend.displayName} size={36} />
        <h1>{friend.displayName}</h1>
      </header>
      <div className="chat-messages" aria-live="polite">
        {messages.loading && <Skeleton variant="bubble" rows={4} />}
        {!messages.loading && ordered.length === 0 && pending.length === 0 && <Empty icon={<SendIcon />}>{t('chat.empty')}</Empty>}
        {ordered.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me?.id ? 'mine' : 'theirs'}`}>
            {/* Platte tekst: React escapet dit, er wordt nooit HTML uitgevoerd */}
            <p>{m.body}</p>
            <time dateTime={m.createdAt}>{formatTime(m.createdAt, locale)}</time>
          </div>
        ))}
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
    </section>
  )
}
