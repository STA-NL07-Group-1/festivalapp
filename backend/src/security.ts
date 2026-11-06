// Wachtwoorden, tokens en codes.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import argon2 from 'argon2'
import { SignJWT, jwtVerify } from 'jose'
import type { AuthUser, Role } from './http.ts'

/** argon2id met de aanbevolen OWASP-parameters */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 })
}

// Een vaste hash om tegen te verifiëren als het e-mailadres niet bestaat,
// zodat de responstijd niet verraadt of een account bestaat.
let dummyHash: Promise<string> | null = null
export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  try {
    return await argon2.verify(hash ?? (await dummyHash), password)
  } catch {
    return false
  }
}

/** Een kleine lijst veelgebruikte wachtwoorden. Vervang later door een HIBP k-anonymity-check. */
const COMMON_PASSWORDS = new Set([
  '123456789012', 'wachtwoord123', 'password1234', 'welkom123456', 'qwertyuiopas', // gitleaks:allow (lijst zwakke wachtwoorden, geen geheim)
  'festival2026!', 'festival2027!', 'wachtwoord12', 'password12345', '000000000000',
])
export function isWeakPassword(password: string, email: string): boolean {
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return true
  if (lower.includes(email.split('@')[0]?.toLowerCase() ?? '\u0000')) return true
  return new Set(password).size < 5
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export const randomToken = () => randomBytes(32).toString('base64url')

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // zonder 0/O en 1/I
/** Vriendcode: XXXX-XXXX */
export function newFriendCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}
export const normalizeCode = (code: string) => code.replace(/-/g, '').toUpperCase()

export async function signAccessToken(user: AuthUser, secret: Uint8Array, ttlSeconds: number): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer('festivalapp')
    .setAudience('festivalapp')
    .sign(secret)
}

export async function verifyAccessToken(token: string, secret: Uint8Array): Promise<AuthUser & { exp: number }> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: 'festivalapp',
    audience: 'festivalapp',
    algorithms: ['HS256'],
  })
  const role = payload.role as Role
  if (!payload.sub || !['bezoeker', 'organisatie', 'beheerder'].includes(role)) throw new Error('ongeldig token')
  return { id: payload.sub, role, exp: payload.exp ?? 0 }
}
