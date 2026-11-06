import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { Locale } from '../lib/format'
import { translate, type Translate } from './translate'

interface I18n {
  locale: Locale
  t: Translate
}

const I18nContext = createContext<I18n>({ locale: 'nl', t: (key, vars) => translate('nl', key, vars) })

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale])
  const value = useMemo(() => ({ locale, t }), [locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => useContext(I18nContext)
