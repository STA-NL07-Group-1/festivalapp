// Informatie van het gekozen festival in het tabblad Meer: plattegrond, veelgestelde vragen,
// huisregels en gevonden voorwerpen. Bovenaan staat de festivalkeuze (als je bij meer
// festivals hoort), zodat je na het openen nog kunt kiezen van welk festival je het wilt zien.
import { useEffect, useState, type ReactNode } from 'react'
import { api, type FestivalInfo, type LostItem } from '../api/client'
import { FestivalBar } from '../components/festival'
import { BackLink, Empty, ErrorNote, Screen, Skeleton } from '../components/ui'
import { useI18n } from '../i18n'
import { formatRelative } from '../lib/format'
import { festivalKey } from '../lib/offlineStore'
import { loadSiteMap } from '../lib/siteMap'
import { useOfflineAsync } from '../lib/useAsync'
import { useSession } from '../state/session'

export type FestivalInfoView = 'plattegrond' | 'faq' | 'huisregels' | 'gevonden'

/** Huisregels, vragen en de datum van de plattegrond van het gekozen festival; ook offline */
function useFestivalInfo() {
  const { festival } = useSession()
  return useOfflineAsync(festivalKey(festival?.id ?? null, 'festival-info'), () => api.get<FestivalInfo>('/festival-info'))
}

function Frame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <Screen title={title}>
      <BackLink title={title} onBack={onBack} />
      <FestivalBar />
      {children}
    </Screen>
  )
}

function SiteMapScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const { festival } = useSession()
  const info = useFestivalInfo()
  const updatedAt = info.data?.siteMapUpdatedAt ?? null
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'laden' | 'klaar' | 'geen' | 'fout'>('laden')
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    if (!festival || info.loading) return
    let cancelled = false
    let objectUrl: string | null = null
    loadSiteMap(festival.id, updatedAt)
      .then((result) => {
        if (cancelled) return
        if (!result) return setState('geen')
        objectUrl = URL.createObjectURL(result.blob)
        setUrl(objectUrl)
        setState('klaar')
      })
      .catch(() => {
        if (!cancelled) setState('fout')
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [festival, updatedAt, info.loading])

  return (
    <Frame title={t('info.siteMap')} onBack={onBack}>
      {state === 'laden' && <Skeleton variant="card" rows={1} />}
      {state === 'geen' && <Empty>{t('info.siteMapNone')}</Empty>}
      {state === 'fout' && <ErrorNote>{t('info.siteMapError')}</ErrorNote>}
      {state === 'klaar' && url && (
        <>
          <div className={`site-map ${zoomed ? 'zoomed' : ''}`}>
            <img src={url} alt={t('info.siteMapAlt', { name: festival?.name ?? '' })} />
          </div>
          <button type="button" className="button small" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed}>
            {zoomed ? t('info.zoomOut') : t('info.zoomIn')}
          </button>
          <p className="muted small">{t('info.siteMapOffline')}</p>
        </>
      )}
    </Frame>
  )
}

function FaqScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const info = useFestivalInfo()
  const faq = info.data?.faq ?? []
  return (
    <Frame title={t('info.faq')} onBack={onBack}>
      {info.loading && <Skeleton variant="text" rows={4} />}
      {info.data && faq.length === 0 && <Empty>{t('info.faqNone')}</Empty>}
      <div className="faq">
        {faq.map((f) => (
          <details key={f.id} className="card">
            <summary>{locale === 'nl' ? f.questionNl : f.questionEn}</summary>
            <p>{locale === 'nl' ? f.answerNl : f.answerEn}</p>
          </details>
        ))}
      </div>
      <p className="muted small">{t('info.faqAssistant')}</p>
    </Frame>
  )
}

function HouseRulesScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const info = useFestivalInfo()
  const text = (locale === 'nl' ? info.data?.houseRulesNl : info.data?.houseRulesEn) ?? info.data?.houseRulesNl ?? ''
  const rules = text
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  return (
    <Frame title={t('info.houseRules')} onBack={onBack}>
      {info.loading && <Skeleton variant="text" rows={4} />}
      {info.data && rules.length === 0 && <Empty>{t('info.houseRulesNone')}</Empty>}
      {rules.length > 0 && (
        <ol className="card rules">
          {rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ol>
      )}
    </Frame>
  )
}

function LostItemsScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const { festival } = useSession()
  const items = useOfflineAsync(festivalKey(festival?.id ?? null, 'lost-items'), () => api.get<LostItem[]>('/lost-items'))
  return (
    <Frame title={t('info.lostItems')} onBack={onBack}>
      <p className="muted">{t('info.lostItemsIntro')}</p>
      {items.loading && <Skeleton rows={3} />}
      {items.data?.length === 0 && <Empty>{t('info.lostItemsNone')}</Empty>}
      <ul className="list">
        {items.data?.map((item) => (
          <li key={item.id} className="row static">
            <span className="emoji" aria-hidden="true">
              🧳
            </span>
            <span className="grow">
              <strong>{item.description}</strong>
              <span className="muted small">
                {item.foundWhere ? `${item.foundWhere} · ` : ''}
                {formatRelative(item.foundAt, locale)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function FestivalInfoScreen({ view, onBack }: { view: FestivalInfoView; onBack: () => void }) {
  const { festival } = useSession()
  // key: bij een ander festival het scherm opnieuw opbouwen, zodat er niets van het vorige festival blijft staan
  const key = festival?.id ?? 'geen'
  if (view === 'plattegrond') return <SiteMapScreen key={key} onBack={onBack} />
  if (view === 'faq') return <FaqScreen key={key} onBack={onBack} />
  if (view === 'huisregels') return <HouseRulesScreen key={key} onBack={onBack} />
  return <LostItemsScreen key={key} onBack={onBack} />
}
