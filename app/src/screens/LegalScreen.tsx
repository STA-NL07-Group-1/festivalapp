import { BackLink, Screen } from '../components/ui'
import { LEGAL } from '../content/legal'
import { useI18n } from '../i18n'
import { formatDay } from '../lib/format'

export function LegalScreen({ which, onBack }: { which: keyof typeof LEGAL; onBack: () => void }) {
  const { t, locale } = useI18n()
  const text = LEGAL[which][locale]
  return (
    <Screen title={text.title}>
      <BackLink title={text.title} onBack={onBack} />
      <article className="legal">
        {text.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
        <p className="muted small">{t('legal.updated', { date: formatDay(text.updated, locale) })}</p>
      </article>
    </Screen>
  )
}
