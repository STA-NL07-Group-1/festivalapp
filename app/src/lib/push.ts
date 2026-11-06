// Web Push aanmelden/afmelden voor dit apparaat.
import { api } from '../api/client'

export type PushState = 'unsupported' | 'denied' | 'server-off' | 'on' | 'off'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? 'on' : 'off'
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const { publicKey } = await api.get<{ publicKey: string | null }>('/push-subscriptions/public-key')
  if (!publicKey) return 'server-off'
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await api.post('/push-subscriptions', { endpoint: json.endpoint, keys: json.keys })
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await api.delete('/push-subscriptions', { endpoint: subscription.endpoint }).catch(() => {})
    await subscription.unsubscribe()
  }
  return 'off'
}
