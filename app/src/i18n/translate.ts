import type { Locale } from '../lib/format'
import { en } from './en'
import { nl, type TranslationKey } from './nl'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { nl, en }

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const text = dictionaries[locale][key] ?? nl[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : text
}

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('festivalapp.locale')
    if (stored === 'nl' || stored === 'en') return stored
  } catch {
    /* geen opslag */
  }
  return navigator.language.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}
