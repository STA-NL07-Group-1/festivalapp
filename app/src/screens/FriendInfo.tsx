// Profiel van een vriend vanuit de chat: wie het is, dempen en wat jullie samen hebben gedeeld.
import type { Friend } from '../api/client'
import { MuteOptions } from '../components/MuteSheet'
import { SharedMedia } from '../components/SharedMedia'
import { Avatar, Sheet } from '../components/ui'
import { useI18n } from '../i18n'
import { useSession } from '../state/session'

export function FriendInfoSheet({
  open,
  onClose,
  friend,
  onMuteChanged,
}: {
  open: boolean
  onClose: () => void
  friend: Friend
  onMuteChanged: (mutedUntil: string | null) => void
}) {
  const { t, locale } = useI18n()
  const { me } = useSession()
  return (
    <Sheet open={open} onClose={onClose} title={friend.displayName}>
      <div className="stack">
        <div className="profile-head">
          <Avatar name={friend.displayName} size={56} />
          <p className="muted">{t('friends.since', { date: new Date(friend.since).toLocaleDateString(locale) })}</p>
        </div>
        <MuteOptions target={{ friendId: friend.id }} name={friend.displayName} mutedUntil={friend.mutedUntil} onChanged={onMuteChanged} />
        {open && <SharedMedia target={{ friendId: friend.id }} names={(id) => (id === me?.id ? t('chat.you') : friend.displayName)} />}
      </div>
    </Sheet>
  )
}
