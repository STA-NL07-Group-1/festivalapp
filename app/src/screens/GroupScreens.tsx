// Groepsapps: een groep maken, en de groepsinfo met leden, gedeelde media en verlaten.
import { useState, type FormEvent } from 'react'
import { api, ApiError, type Friend, type GroupDetail } from '../api/client'
import { MuteOptions } from '../components/MuteSheet'
import { SharedMedia } from '../components/SharedMedia'
import { Avatar, ErrorNote, Sheet } from '../components/ui'
import { useI18n } from '../i18n'
import type { Translate as TFunction } from '../i18n/translate'
import { useAsync } from '../lib/useAsync'
import { useSession } from '../state/session'

/** Vrienden aanvinken (voor een nieuwe groep of om leden toe te voegen) */
function FriendPicker({ friends, selected, onChange }: { friends: Friend[]; selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }) {
  const { t } = useI18n()
  if (friends.length === 0) return <p className="muted">{t('group.noFriendsToAdd')}</p>
  return (
    <ul className="list pick-list">
      {friends.map((f) => (
        <li key={f.id}>
          <label className="row pick-row">
            <Avatar name={f.displayName} size={36} />
            <span className="grow">{f.displayName}</span>
            <input
              type="checkbox"
              checked={selected.has(f.id)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(f.id)
                else next.delete(f.id)
                onChange(next)
              }}
            />
          </label>
        </li>
      ))}
    </ul>
  )
}

function errorText(e: unknown, t: TFunction): string {
  if (e instanceof ApiError && e.status === 0) return t('common.offline')
  if (e instanceof ApiError && (e.status === 400 || e.status === 403)) return e.message
  return t('common.error')
}

/** Nieuwe groep: naam en vrienden kiezen. Na het maken opent de groepschat. */
export function NewGroupSheet({ open, onClose, friends, onCreated }: { open: boolean; onClose: () => void; friends: Friend[]; onCreated: (group: GroupDetail) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const group = await api.post<GroupDetail>('/groups', { name: name.trim(), memberIds: [...selected] })
      setName('')
      setSelected(new Set())
      onCreated(group)
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('group.new')}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          {t('group.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder={t('group.namePlaceholder')} />
        </label>
        <p className="label">{t('group.pickFriends')}</p>
        <FriendPicker friends={friends} selected={selected} onChange={setSelected} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button className="button primary" disabled={busy || !name.trim() || selected.size === 0}>
          {busy ? t('common.loading') : t('group.create', { count: selected.size + 1 })}
        </button>
      </form>
    </Sheet>
  )
}

/**
 * Groepsinfo: leden (met wie beheerder is), gedeelde foto's en video's, en voor de beheerder:
 * naam aanpassen, leden toevoegen en verwijderen. Iedereen kan de groep verlaten.
 */
export function GroupInfoSheet({
  open,
  onClose,
  group,
  onChanged,
  onMuteChanged,
  onLeft,
}: {
  open: boolean
  onClose: () => void
  group: GroupDetail | null
  onChanged: () => void
  onMuteChanged: (mutedUntil: string | null) => void
  onLeft: () => void
}) {
  const { t } = useI18n()
  const { me } = useSession()
  const admin = group?.myRole === 'beheerder'
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const friends = useAsync(() => (open && admin ? api.get<Friend[]>('/friends') : Promise.resolve([] as Friend[])), [open, admin])

  if (!group) return <Sheet open={open} onClose={onClose} title={t('group.info')}>{null}</Sheet>
  const inGroup = new Set(group.members.map((m) => m.id))
  const addable = (friends.data ?? []).filter((f) => !inGroup.has(f.id))
  const nameOf = (id: string) => (id === me?.id ? t('chat.you') : (group.members.find((m) => m.id === id)?.displayName ?? t('chat.formerMember')))

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      onChanged()
      return true
    } catch (e) {
      setError(errorText(e, t))
      return false
    }
  }

  async function addMembers() {
    if (selected.size === 0) return
    if (await run(() => api.post(`/groups/${group!.id}/members`, { userIds: [...selected] }))) {
      setSelected(new Set())
      setAdding(false)
    }
  }

  async function rename(event: FormEvent) {
    event.preventDefault()
    const name = renaming?.trim()
    if (!name) return
    if (await run(() => api.patch(`/groups/${group!.id}`, { name }))) setRenaming(null)
  }

  async function removeMember(id: string, displayName: string) {
    if (!window.confirm(t('group.removeConfirm', { name: displayName }))) return
    await run(() => api.delete(`/groups/${group!.id}/members/${id}`))
  }

  async function leave() {
    if (!me || !window.confirm(t('group.leaveConfirm', { name: group!.name }))) return
    if (await run(() => api.delete(`/groups/${group!.id}/members/${me.id}`))) {
      onClose()
      onLeft()
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={group.name}>
      <div className="stack">
        {admin &&
          (renaming === null ? (
            <button type="button" className="link" onClick={() => setRenaming(group.name)}>
              {t('group.rename')}
            </button>
          ) : (
            <form className="inline-form" onSubmit={(e) => void rename(e)}>
              <label className="grow">
                {t('group.name')}
                <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={60} required />
              </label>
              <button className="button small">{t('common.save')}</button>
            </form>
          ))}

        <section aria-labelledby="group-members-title">
          <div className="shared-media-head">
            <h3 id="group-members-title">{t('group.members', { count: group.members.length })}</h3>
            {admin && !adding && (
              <button type="button" className="link" onClick={() => setAdding(true)}>
                + {t('group.addMembers')}
              </button>
            )}
          </div>
          {adding && (
            <div className="stack">
              <FriendPicker friends={addable} selected={selected} onChange={setSelected} />
              <div className="row-actions">
                <button type="button" className="button small" onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="button primary small" disabled={selected.size === 0} onClick={() => void addMembers()}>
                  {t('friends.addButton')}
                </button>
              </div>
            </div>
          )}
          <ul className="list">
            {group.members.map((m) => (
              <li key={m.id} className="row member-row">
                <Avatar name={m.displayName} size={36} />
                <span className="grow">
                  {m.id === me?.id ? t('chat.you') : m.displayName}
                  {m.role === 'beheerder' && <span className="badge">{t('group.admin')}</span>}
                </span>
                {admin && m.id !== me?.id && (
                  <button type="button" className="link danger" onClick={() => void removeMember(m.id, m.displayName)}>
                    {t('common.delete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <MuteOptions target={{ groupId: group.id }} name={group.name} mutedUntil={group.mutedUntil} onChanged={onMuteChanged} />

        {open && <SharedMedia target={{ groupId: group.id }} names={nameOf} />}

        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="button" className="button danger-outline" onClick={() => void leave()}>
          {t('group.leave')}
        </button>
      </div>
    </Sheet>
  )
}
