// QR-scanner met de ingebouwde BarcodeDetector van de browser (Chrome/Android).
// Werkt die niet, dan valt de gebruiker terug op code overtypen of de camera-app.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  const [failed, setFailed] = useState(!Detector || !navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    if (failed || !Detector) return
    let stream: MediaStream | null = null
    let stopped = false
    const detector = new Detector({ formats: ['qr_code'] })

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current || stopped) return
        video.current.srcObject = stream
        await video.current.play()
        while (!stopped) {
          const codes = await detector.detect(video.current)
          if (codes[0]?.rawValue) {
            onResult(codes[0].rawValue)
            return
          }
          await new Promise((r) => setTimeout(r, 250))
        }
      } catch {
        setFailed(true)
      }
    }
    void run()
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [Detector, failed, onResult])

  if (failed) {
    return (
      <div className="card">
        <p className="muted">{t('friends.scanUnsupported')}</p>
        <button type="button" className="link" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    )
  }

  return (
    <div className="scanner">
      <video ref={video} playsInline muted aria-label={t('friends.scanHint')} />
      <p className="muted small">{t('friends.scanHint')}</p>
      <button type="button" className="button" onClick={onClose}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
