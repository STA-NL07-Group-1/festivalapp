import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import { api, type CrowdLevel, type FriendLocation, type Pin, type Stage } from '../api/client'
import { PinIcon } from '../components/icons'
import { SosButton } from '../components/SosButton'
import { Segmented, Sheet } from '../components/ui'
import { useI18n } from '../i18n'
import { distanceM, formatRelative, initials } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'

const CROWD_COLORS: Record<string, string> = {
  rustig: '#22c55e',
  gemiddeld: '#eab308',
  druk: '#f97316',
  vol: '#ef4444',
}

// Eigen markers met HTML, zodat we geen afbeeldingen van Leaflet nodig hebben
const friendIcon = (name: string) =>
  L.divIcon({ className: 'marker-friend', html: `<span>${escapeHtml(initials(name))}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
const pinIcon = L.divIcon({ className: 'marker-pin', html: '<span>📍</span>', iconSize: [28, 28], iconAnchor: [14, 26] })
const meIcon = L.divIcon({ className: 'marker-me', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const SEND_EVERY_MS = 30_000
const SEND_IF_MOVED_M = 15

function ClickToPlace({ active, onPlace }: { active: boolean; onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onPlace(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function MapScreen() {
  const { t, locale } = useI18n()
  const { me, updateMe, dark } = useSession()
  const stages = useAsync(() => api.get<Stage[]>('/stages'))
  const crowd = useAsync(() => api.get<CrowdLevel[]>('/crowd'))
  const friends = useAsync(() => api.get<FriendLocation[]>('/friends/locations'))
  const pins = useAsync(() => api.get<Pin[]>('/pins'))

  const [myPosition, setMyPosition] = useState<GeolocationCoordinates | null>(null)
  const [geoError, setGeoError] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null)
  const [visibility, setVisibility] = useState<'vrienden' | 'prive'>('vrienden')
  const lastSent = useRef<{ at: number; lat: number; lng: number } | null>(null)

  // Live updates
  const setFriends = friends.setData
  useRealtime<FriendLocation>(
    'friend.location',
    useCallback((loc) => setFriends((list) => [...(list ?? []).filter((f) => f.userId !== loc.userId), loc]), [setFriends]),
  )
  useRealtime<{ userId: string }>(
    'friend.location.removed',
    useCallback(({ userId }) => setFriends((list) => (list ?? []).filter((f) => f.userId !== userId)), [setFriends]),
  )
  const setCrowd = crowd.setData
  useRealtime<CrowdLevel>(
    'crowd.update',
    useCallback((c) => setCrowd((list) => [...(list ?? []).filter((x) => x.stageId !== c.stageId), c]), [setCrowd]),
  )
  const setPins = pins.setData
  useRealtime<Pin>('pin.created', useCallback((p) => setPins((list) => [p, ...(list ?? [])]), [setPins]))

  // Eigen locatie volgen en (als delen aan staat) doorsturen
  const sharing = me?.shareLocation ?? false
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(false)
        setMyPosition(pos.coords)
        if (!sharing) return
        const last = lastSent.current
        const moved = last ? distanceM({ latitude: last.lat, longitude: last.lng }, pos.coords) : Infinity
        if (!last || Date.now() - last.at > SEND_EVERY_MS || moved > SEND_IF_MOVED_M) {
          lastSent.current = { at: Date.now(), lat: pos.coords.latitude, lng: pos.coords.longitude }
          api
            .put('/me/location', {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyM: Math.min(Math.round(pos.coords.accuracy), 10000),
            })
            .catch(() => {
              lastSent.current = null
            })
        }
      },
      () => setGeoError(true),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [sharing])

  const center = useMemo<[number, number]>(() => {
    const list = stages.data ?? []
    if (list.length === 0) return [52.387, 4.877]
    return [list.reduce((s, x) => s + x.latitude, 0) / list.length, list.reduce((s, x) => s + x.longitude, 0) / list.length]
  }, [stages.data])

  const crowdFor = (stageId: string) => crowd.data?.find((c) => c.stageId === stageId)

  async function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const label = String(new FormData(event.currentTarget).get('label') ?? '').trim()
    if (!label) return
    const pin = await api.post<Pin>('/pins', { label, latitude: draft.lat, longitude: draft.lng, visibility })
    setPins((list) => [pin, ...(list ?? [])])
    setDraft(null)
    setPlacing(false)
  }

  async function deletePin(id: string) {
    await api.delete(`/pins/${id}`)
    setPins((list) => (list ?? []).filter((p) => p.id !== id))
  }

  return (
    <section className="map-screen" aria-label={t('map.title')}>
      {!stages.loading && (
        <MapContainer center={center} zoom={17} className="map" zoomControl={false} attributionControl>
          {/* Kaartstijl volgt het thema; 's nachts een donkere kaart zodat het scherm niet verblindt */}
          <TileLayer
            key={dark ? 'dark' : 'light'}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`}
            subdomains="abcd"
            maxZoom={20}
          />
          <ClickToPlace active={placing} onPlace={(lat, lng) => setDraft({ lat, lng })} />

          {stages.data?.map((stage) => {
            const c = crowdFor(stage.id)
            return (
              <CircleMarker
                key={stage.id}
                center={[stage.latitude, stage.longitude]}
                radius={22}
                pathOptions={{ color: c ? CROWD_COLORS[c.level] : '#a79dc4', fillOpacity: 0.35, weight: 3 }}
              >
                <Tooltip direction="top" permanent className="stage-label">
                  {stage.name}
                </Tooltip>
                <Popup>
                  <strong>{stage.name}</strong>
                  <br />
                  {t('map.legend')}: {c ? t(`crowd.${c.level}`) : t('crowd.unknown')}
                </Popup>
              </CircleMarker>
            )
          })}

          {pins.data?.map((pin) => (
            <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={pinIcon}>
              <Popup>
                <strong>{pin.label}</strong>
                {pin.userId === me?.id && (
                  <>
                    <br />
                    <button type="button" className="link danger" onClick={() => void deletePin(pin.id)}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </Popup>
            </Marker>
          ))}

          {friends.data?.map((f) => (
            <Marker key={f.userId} position={[f.latitude, f.longitude]} icon={friendIcon(f.displayName)}>
              <Popup>
                <strong>{f.displayName}</strong>
                <br />
                {t('map.updated', { time: formatRelative(f.recordedAt, locale) })}
              </Popup>
            </Marker>
          ))}

          {myPosition && (
            <Marker position={[myPosition.latitude, myPosition.longitude]} icon={meIcon}>
              <Tooltip>{t('map.you')}</Tooltip>
            </Marker>
          )}
        </MapContainer>
      )}

      <div className="map-overlay top">
        <button
          type="button"
          className={`chip ${sharing ? 'active' : ''}`}
          aria-pressed={sharing}
          onClick={() => void updateMe({ shareLocation: !sharing })}
        >
          <span className="dot" aria-hidden="true" /> {sharing ? t('map.sharing') : t('map.notSharing')}
        </button>
        {geoError && sharing && <p className="map-note">{t('map.geoDenied')}</p>}
        {placing && !draft && <p className="map-note">{t('map.tapToPlace')}</p>}
      </div>

      <div className="map-legend" aria-label={t('map.legend')}>
        {Object.entries(CROWD_COLORS).map(([level, color]) => (
          <span key={level}>
            <i style={{ background: color }} aria-hidden="true" />
            {t(`crowd.${level as 'rustig'}`)}
          </span>
        ))}
      </div>

      <div className="map-overlay bottom">
        <button type="button" className={`fab secondary ${placing ? 'active' : ''}`} aria-pressed={placing} onClick={() => setPlacing(!placing)}>
          <PinIcon /> <span>{t('map.addPin')}</span>
        </button>
        <SosButton position={myPosition} />
      </div>

      <Sheet open={draft !== null} onClose={() => setDraft(null)} title={t('map.addPin')}>
        <form className="form" onSubmit={(e) => void savePin(e)}>
          <label>
            {t('map.pinLabel')}
            <input name="label" required maxLength={60} autoFocus />
          </label>
          <Segmented
            label={t('map.pinLabel')}
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'vrienden', label: t('map.pinFriends') },
              { value: 'prive', label: t('map.pinPrivate') },
            ]}
          />
          <button className="button primary">{t('common.save')}</button>
        </form>
      </Sheet>
    </section>
  )
}
