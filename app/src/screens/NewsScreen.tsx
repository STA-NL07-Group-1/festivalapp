import type { Announcement } from '../api/client'
import { BellIcon } from '../components/icons'
import { Empty, Screen } from '../components/ui'
import { useI18n } from '../i18n'
import { formatRelative } from '../lib/format'

// eslint-disable-next-line react-refresh/only-export-components
export function announcementText(a: Announcement, locale: 'nl' | 'en') {
  return locale === 'nl' ? { title: a.titleNl, body: a.bodyNl } : { title: a.titleEn, body: a.bodyEn }
}

export function NewsScreen({ announcements }: { announcements: Announcement[] }) {
  const { t, locale } = useI18n()
  return (
    <Screen title={t('news.title')}>
      {announcements.length === 0 && <Empty icon={<BellIcon />}>{t('news.empty')}</Empty>}
      <ul className="list news stagger">
        {announcements.map((a) => {
          const { title, body } = announcementText(a, locale)
          return (
            <li key={a.id} className={`announcement ${a.level}`}>
              <span className={`badge ${a.level}`}>{t(`news.level.${a.level}`)}</span>
              <h2>{title}</h2>
              <p>{body}</p>
              <time className="muted small" dateTime={a.createdAt}>
                {formatRelative(a.createdAt, locale)}
              </time>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}
