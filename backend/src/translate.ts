// Automatisch vertalen tussen Nederlands en Engels met LibreTranslate.
// LibreTranslate draait als eigen container naast de backend (zie compose.prod.yaml): de teksten gaan
// dus niet naar een externe dienst. Zonder TRANSLATE_URL (lokaal) wordt er niets vertaald.
//
// Werkwijze:
//  1. Taal herkennen (/detect). Is LibreTranslate niet zeker genoeg, of is het geen Nederlands of
//     Engels, dan gaan we uit van de taal waarin het account van de schrijver staat.
//  2. Naar de andere taal vertalen (/translate).
//  3. Lukt dat niet (container uit, te traag), dan krijg je de originele tekst in beide talen terug
//     met `failed: true`. Een mededeling of noodbericht mag nooit blijven hangen op de vertaler.

export type Locale = 'nl' | 'en'

/** Dezelfde teksten in het Nederlands en het Engels, in dezelfde volgorde als ze erin gingen */
export interface Bilingual {
  nl: string[]
  en: string[]
  /** De herkende (of aangenomen) taal van de schrijver */
  source: Locale
  /** true = vertalen is mislukt; nl en en zijn dan allebei de originele tekst */
  failed: boolean
}

export interface Translator {
  enabled: boolean
  /**
   * Vertaalt een paar teksten die bij elkaar horen (bijv. titel en tekst). De taal wordt één keer
   * herkend op alle teksten samen, zodat een korte titel niet als een andere taal wordt gezien.
   */
  translate(texts: string[], fallback: Locale): Promise<Bilingual>
}

// LibreTranslate geeft een zekerheid van 0 tot 100. Daaronder gokken we niet en nemen we de taal van de app.
const MIN_CONFIDENCE = 50
const TIMEOUT_MS = 8_000

const other = (locale: Locale): Locale => (locale === 'nl' ? 'en' : 'nl')

function unchanged(texts: string[], source: Locale, failed: boolean): Bilingual {
  return { nl: [...texts], en: [...texts], source, failed }
}

export function createTranslator(url: string | null, apiKey: string | null = null): Translator {
  // Zonder vertaler: niets vertalen en dat ook zo melden (failed), zodat het portal het kan laten zien
  if (!url) return { enabled: false, translate: async (texts, fallback) => unchanged(texts, fallback, texts.some((t) => t.trim() !== '')) }
  const base = url.replace(/\/+$/, '')

  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiKey ? { ...body, api_key: apiKey } : body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`LibreTranslate ${path}: ${response.status}`)
    return (await response.json()) as T
  }

  async function detect(text: string, fallback: Locale): Promise<Locale> {
    const results = await call<{ language: string; confidence: number }[]>('/detect', { q: text })
    const best = results[0]
    if (best && (best.language === 'nl' || best.language === 'en') && best.confidence >= MIN_CONFIDENCE) return best.language
    return fallback
  }

  return {
    enabled: true,
    async translate(texts, fallback) {
      const filled = texts.filter((t) => t.trim() !== '')
      if (filled.length === 0) return unchanged(texts, fallback, false)
      let source = fallback
      try {
        source = await detect(filled.join('\n'), fallback)
        const target = other(source)
        // Lege velden niet naar de vertaler sturen
        const translated = await Promise.all(
          texts.map(async (text) =>
            text.trim() === ''
              ? text
              : (await call<{ translatedText: string }>('/translate', { q: text, source, target, format: 'text' })).translatedText,
          ),
        )
        return source === 'nl'
          ? { nl: [...texts], en: translated, source, failed: false }
          : { nl: translated, en: [...texts], source, failed: false }
      } catch (error) {
        console.warn('Vertalen mislukt, originele tekst gebruikt:', (error as Error).message)
        return unchanged(texts, source, true)
      }
    },
  }
}

/** De taal waarin het account van de schrijver staat: daar gaan we van uit als de taal niet te herkennen is */
export async function authorLocale(db: { query: (sql: string, params: unknown[]) => Promise<{ rows: { locale: Locale }[] }> }, userId: string): Promise<Locale> {
  const { rows } = await db.query('SELECT locale FROM users WHERE id = $1', [userId])
  return rows[0]?.locale ?? 'nl'
}

type Texts<K extends string> = Record<K, string>

/**
 * Teksten in beide talen voor een formulier uit het portal. Er zijn twee manieren:
 *  - `auto`: elk veld één keer, in één taal → wordt herkend en vertaald;
 *  - `manual`: elk veld als [nl, en] → wordt zo opgeslagen (de organisatie heeft de vertaling zelf verbeterd).
 * Alles wordt getrimd. Geeft null als geen van beide compleet is.
 */
export async function bilingual<K extends string>(
  translator: Translator,
  auto: Record<K, string | undefined>,
  manual: Record<K, [string | undefined, string | undefined]>,
  fallback: () => Promise<Locale>,
): Promise<{ nl: Texts<K>; en: Texts<K>; failed: boolean } | null> {
  const keys = Object.keys(auto) as K[]
  const build = (nl: string[], en: string[]) => ({
    nl: Object.fromEntries(keys.map((k, i) => [k, nl[i] ?? ''])) as Texts<K>,
    en: Object.fromEntries(keys.map((k, i) => [k, en[i] ?? ''])) as Texts<K>,
  })
  if (keys.every((k) => auto[k] !== undefined)) {
    const result = await translator.translate(
      keys.map((k) => auto[k]!.trim()),
      await fallback(),
    )
    return { ...build(result.nl.map((t) => t.trim()), result.en.map((t) => t.trim())), failed: result.failed }
  }
  if (keys.every((k) => manual[k][0] !== undefined && manual[k][1] !== undefined)) {
    return { ...build(keys.map((k) => manual[k][0]!.trim()), keys.map((k) => manual[k][1]!.trim())), failed: false }
  }
  return null
}
