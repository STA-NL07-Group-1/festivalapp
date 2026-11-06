import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type Friend, type Message } from '../api/client'
import { BackIcon, SendIcon } from '../components/icons'
import { Avatar, Empty, ErrorNote } from '../components/ui'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'

export function ChatScreen({ friend, onBack }: { friend: Friend; onBack: () => void }) {
  const { t, locale } = useI18n()
  const { me } = useSession()
  const messages = useAsync(() => api.get<Message[]>(`/messages/${friend.id}?limit=100`), [friend.id])
  const [text, setText] = useState('')
  const [error, setError] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const setMessages = messages.setData
  useRealtime<Message>(
    'chat.message',
    useCallback(
      (m) => {
        const inConversation =
          (m.senderId === friend.id && m.recipientId === me?.id) || (m.senderId === me?.id && m.recipientId === friend.id)
        if (inConversation) setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [m, ...(list ?? [])]))
      },
      [friend.id, me?.id, setMessages],
    ),
  )

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.data])

  async function send(event: FormEvent) {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    setError(false)
    try {
      const message = await api.post<Message>(`/messages/${friend.id}`, { body })
      setMessages((list) => (list?.some((x) => x.id === message.id) ? list : [message, ...(list ?? [])]))
    } catch {
      setText(body)
      setError(true)
    }
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
        {!messages.loading && ordered.length === 0 && <Empty>{t('chat.empty')}</Empty>}
        {ordered.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === me?.id ? 'mine' : 'theirs'}`}>
            {/* Platte tekst: React escapet dit, er wordt nooit HTML uitgevoerd */}
            <p>{m.body}</p>
            <time dateTime={m.createdAt}>{formatTime(m.createdAt, locale)}</time>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {error && <ErrorNote>{t('common.error')}</ErrorNote>}
      <form className="chat-input" onSubmit={(e) => void send(e)}>
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
