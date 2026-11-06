import { describe, expect, it } from 'vitest'
import { en } from './en'
import { translate } from './translate'
import { nl } from './nl'

describe('vertalingen', () => {
  it('Engels heeft precies dezelfde sleutels als Nederlands', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort())
  })

  it('geen lege teksten', () => {
    for (const [key, value] of [...Object.entries(nl), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('placeholders zijn in beide talen gelijk', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(nl) as (keyof typeof nl)[]) {
      expect(vars(en[key]), key).toEqual(vars(nl[key]))
    }
  })

  it('vult variabelen in', () => {
    expect(translate('nl', 'friends.added', { name: 'Bram' })).toBe('Bram is toegevoegd!')
    expect(translate('en', 'friends.added', { name: 'Bram' })).toBe('Bram has been added!')
  })
})
