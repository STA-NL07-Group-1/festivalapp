import { describe, expect, it } from 'vitest'
import { weakPasswordReason } from '../src/security.ts'

describe('weakPasswordReason', () => {
  const email = 'sanne@example.com'

  it('keurt een goed wachtwoord goed', () => {
    expect(weakPasswordReason('paars-tent-regen-42', email)).toBeNull()
  })

  it('zegt waarom een wachtwoord te zwak is', () => {
    expect(weakPasswordReason('kort-12', email)).toContain('minstens 12 tekens')
    expect(weakPasswordReason('wachtwoord123', email)).toContain('te vaak gebruikt')
    expect(weakPasswordReason('Sanne-op-het-festival', email)).toContain('e-mailadres')
    expect(weakPasswordReason('abababababab', email)).toContain('verschillende tekens')
  })
})
