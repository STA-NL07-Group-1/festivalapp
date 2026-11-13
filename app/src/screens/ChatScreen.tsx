import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type Friend, type Message } from '../api/client'
import { BackIcon, SendIcon } from '../components/icons'
import { Avatar, Empty, Skeleton } from '../components/ui'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'

/** Bericht dat al op het scherm staat, maar nog niet (of niet goed) bij de server is aangekomen */
type Pending = { key: string; body: string; failed: boolean }

export function ChatScreen({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const { t, locale } = useI18n()
  const { me } = useSession()
  const messages = useAsync(() => api.get<Message[]>(`/messages/${friend.id}?limit=100`), [friend.id])
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
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
        // Eigen bericht via de WebSocket eerder binnen dan het antwoord op de POST: niet twee keer tonen
        if (m.senderId === me?.id) {
          setPending((list) => {
            const index = list.findIndex((p) => !p.failed && p.body === m.body)
            return index === -1 ? list : list.filter((_, i) => i !== index)
          })
        }
      },
      [friend.id, me?.id, setMessages],
    ),
  )

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.data, pending.length])

  async function deliver(item: Pending) {
    setPending((list) => list.map((p) => (p.key === item.key ? { ...p, failed: false } : p)))
    try {
      const message = await api.post<Message>(`/messages/${friend.id}`, { body: item.body })
      setMessages((list) => (list?.some((x) => x.id === message.id) ? list : [message, ...(list ?? [])]))
      setPending((list) => list.filter((p) => p.key !== item.key))
    } catch {
      setPending((list) => list.map((p) => (p.key === item.key ? { ...p, failed: true } : p)))
    }
  }

  // Optimistic update: het bericht staat meteen op het scherm en wordt vol zodra de server het heeft
  function send(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    const item: Pending = { key: crypto.randomUUID(), body, failed: false }
    setPending((list) => [...list, item])
    void deliver(item)
  }

  // De API geeft nieuwste eerst; we tonen oudste bovenaan
  const ordered = [...(messages.data ?? [])].reverse()

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
        {pending.map((p) => (
          <div key={p.key} className={`bubble mine ${p.failed ? 'failed' : 'sending'}`}>
            <p>{p.body}</p>
            {p.failed ? (
              <button type="button" className="bubble-retry" onClick={() => void deliver(p)}>
                {t('chat.failed')} · {t('chat.retry')}
              </button>
            ) : (
              <span className="bubble-status">{t('chat.sending')}</span>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form className="chat-input" onSubmit={send}>
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
