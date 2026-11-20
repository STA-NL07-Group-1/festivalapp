import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import { api, ApiError, currentFestival, type CrowdLevel, type FriendLocation, type MapPoint, type MapPointKind, type Pin, type Stage } from '../api/client'
import { PinIcon } from '../components/icons'
import { SosButton } from '../components/SosButton'
import { Segmented, Sheet } from '../components/ui'
import { useI18n } from '../i18n'
import { distanceM, formatRelative, formatTime, initials } from '../lib/format'
import { festivalKey, loadOffline, saveOffline } from '../lib/offlineStore'
import { deliverPin, enqueuePin, flushOutbox, isPinItem, removeFromOutbox, useOutbox } from '../lib/outbox'
import { useAsync, useOfflineAsync } from '../lib/useAsync'
import { useRealtime, useSession } from '../state/session'

/** Zo lang mag de live-verbinding weg zijn voordat we het op de kaart laten zien */
const NOT_LIVE_AFTER_MS = 8_000

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
// Pin die nog in de wachtrij staat (geen bereik): doorzichtig, tot de server hem heeft
const pendingPinIcon = L.divIcon({ className: 'marker-pin pending', html: '<span>📍</span>', iconSize: [28, 28], iconAnchor: [14, 26] })
const meIcon = L.divIcon({ className: 'marker-me', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })
// Laatst bekende eigen positie (zonder actuele GPS): grijs in plaats van blauw
const meLastIcon = L.divIcon({ className: 'marker-me last-known', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

// Kaartpunten van de organisatie: een vast teken per soort, zodat je ze ook zonder kleur herkent
const POINT_SYMBOL: Record<MapPointKind, string> = {
  wifi: '📶',
  ehbo: '✚',
  water: '💧',
  toilet: 'WC',
  ingang: '⇥',
  uitgang: '⇤',
  eten: '🍴',
  activiteit: '★',
  oplaadpunt: '€',
  info: 'i',
}
const pointIcons = new Map<MapPointKind, L.DivIcon>()
function pointIcon(kind: MapPointKind): L.DivIcon {
  let icon = pointIcons.get(kind)
  if (!icon) {
    icon = L.divIcon({
      className: `marker-point ${kind}`,
      html: `<span>${escapeHtml(POINT_SYMBOL[kind])}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    })
    pointIcons.set(kind, icon)
  }
  return icon
}

interface LastPosition {
  latitude: number
  longitude: number
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

// CARTO-kaarten (donker/licht) als er een sleutel is; anders OpenStreetMap met een donkerfilter.
// De sleutel staat in de browser (zoals elke kaartsleutel): beperk hem in CARTO tot jullie domein.
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined)?.trim()

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
  const { me, updateMe, dark, online, live } = useSession()
  // Podia, kaartpunten, pins en vrienden worden op de telefoon bewaard voor als er geen internet is.
  // Drukte niet: een oude drukte-meting is eerder misleidend dan nuttig.
  // Elk festival heeft zijn eigen bewaarde gegevens. App.tsx bouwt dit scherm opnieuw op
  // als je van festival wisselt, dus de sleutels veranderen niet terwijl het scherm open is.
  const key = (name: string) => festivalKey(me?.festivalId ?? null, name)
  const stages = useOfflineAsync(key('stages'), () => api.get<Stage[]>('/stages'))
  const points = useOfflineAsync(key('map-points'), () => api.get<MapPoint[]>('/map-points'))
  const crowd = useAsync(() => api.get<CrowdLevel[]>('/crowd'))
  const friends = useOfflineAsync(key('friends-locations'), () => api.get<FriendLocation[]>('/friends/locations'))
  const pins = useOfflineAsync(key('pins'), () => api.get<Pin[]>('/pins'))

  // Internet terug (van offline naar online): alles opnieuw ophalen
  const reloadStages = stages.reload
  const reloadPoints = points.reload
  const reloadFriends = friends.reload
  const reloadPins = pins.reload
  const reloadCrowd = crowd.reload
  const reloadAll = useCallback(() => {
    void reloadStages()
    void reloadPoints()
    void reloadFriends()
    void reloadPins()
    void reloadCrowd()
  }, [reloadStages, reloadPoints, reloadFriends, reloadPins, reloadCrowd])
  const wasOnline = useRef(online)
  useEffect(() => {
    const cameBack = online && !wasOnline.current
    wasOnline.current = online
    // Eerst wat in de wachtrij staat versturen (zoals pins), dan alles opnieuw ophalen
    if (cameBack) void flushOutbox().then(reloadAll)
  }, [online, reloadAll])

  // Live-verbinding terug na een onderbreking (slaapstand, ander netwerk, nieuw token):
  // wat er in de tussentijd veranderde kwam niet binnen, dus alles opnieuw ophalen.
  // De eerste keer verbinden niet: dan worden de gegevens net al opgehaald.
  const wasLive = useRef<boolean | null>(null)
  useEffect(() => {
    const reconnected = live && wasLive.current === false
    if (live || wasLive.current !== null) wasLive.current = live
    if (reconnected) reloadAll()
  }, [live, reloadAll])

  // Wel internet maar even geen live-verbinding? Na een paar seconden melden dat posities oud kunnen zijn.
  // Niet meteen: bij een nieuw token (elk kwartier) is de verbinding binnen een seconde weer terug.
  const [notLive, setNotLive] = useState(false)
  useEffect(() => {
    if (live || !online) return
    const timer = setTimeout(() => setNotLive(true), NOT_LIVE_AFTER_MS)
    return () => {
      clearTimeout(timer)
      setNotLive(false)
    }
  }, [live, online])

  const [myPosition, setMyPosition] = useState<GeolocationCoordinates | null>(null)
  const [lastPosition] = useState(() => loadOffline<LastPosition>('my-position'))
  const [geoError, setGeoError] = useState(false)
  const [pinError, setPinError] = useState<'map.pinFailed' | 'map.pinDeleteFailed' | null>(null)
  // Pins die nog niet bij de server zijn (geen bereik); alleen die van het festival dat nu open is
  const outbox = useOutbox()
  const pendingPins = useMemo(() => outbox.filter(isPinItem).filter((p) => p.festivalId === currentFestival()), [outbox])
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
  // Ook je eigen pins komen hier binnen (de server stuurt ze ook naar jou), dus niet dubbel toevoegen
  useRealtime<Pin>(
    'pin.created',
    useCallback((p) => setPins((list) => (list?.some((x) => x.id === p.id) ? list : [p, ...(list ?? [])])), [setPins]),
  )
  useRealtime<{ id: string }>(
    'pin.removed',
    useCallback(({ id }) => setPins((list) => (list ?? []).filter((p) => p.id !== id)), [setPins]),
  )
  const setPoints = points.setData
  useRealtime<MapPoint>(
    'map_point.update',
    useCallback((point) => setPoints((list) => [...(list ?? []).filter((x) => x.id !== point.id), point]), [setPoints]),
  )
  useRealtime<{ id: string }>(
    'map_point.removed',
    useCallback(({ id }) => setPoints((list) => (list ?? []).filter((x) => x.id !== id)), [setPoints]),
  )

  // Eigen locatie volgen en (als delen aan staat) doorsturen
  const sharing = me?.shareLocation ?? false
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(false)
        setMyPosition(pos.coords)
        // Ook bewaren, zodat je na het opnieuw openen zonder GPS-signaal je laatste plek ziet
        saveOffline<LastPosition>('my-position', { latitude: pos.coords.latitude, longitude: pos.coords.longitude })
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
    // Eerst in de wachtrij: zonder bereik staat de pin meteen (doorzichtig) op de kaart en gaat hij
    // vanzelf naar de server zodra er weer bereik is. Met bereik gaat hij meteen.
    const item = enqueuePin({ label, latitude: draft.lat, longitude: draft.lng, visibility })
    setDraft(null)
    setPlacing(false)
    setPinError(null)
    if (!online) return
    try {
      const pin = await deliverPin(item)
      setPins((list) => (list?.some((p) => p.id === pin.id) ? list : [pin, ...(list ?? [])]))
    } catch (error) {
      // Weigert de server hem voorgoed, dan is hij al uit de wachtrij; anders blijft hij wachten
      if (error instanceof ApiError && (error.status === 400 || error.status === 404)) setPinError('map.pinFailed')
    }
  }

  async function deletePin(id: string) {
    try {
      await api.delete(`/pins/${id}`)
      setPins((list) => (list ?? []).filter((p) => p.id !== id))
    } catch {
      // Geen bereik: de pin blijft staan, je kunt het straks opnieuw proberen
      setPinError('map.pinDeleteFailed')
    }
  }

  return (
    <section className="map-screen" aria-label={t('map.title')}>
      {!stages.loading && (
        <MapContainer center={center} zoom={17} className={`map ${dark && !CARTO_KEY ? 'map-dark' : ''} ${online ? '' : 'offline'}`} zoomControl={false} attributionControl>
          {CARTO_KEY ? (
            // 's Nachts de donkere CARTO-kaart, zodat het scherm niet verblindt
            <TileLayer
              key={dark ? 'dark' : 'light'}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={`https://basemaps.cartocdn.com/rastertiles/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`}
              maxZoom={20}
            />
          ) : (
            // Zonder sleutel: OpenStreetMap; .map-dark in index.css maakt de tegels donker
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
          )}
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

          {points.data?.map((point) => (
            <Marker key={point.id} position={[point.latitude, point.longitude]} icon={pointIcon(point.kind)}>
              <Tooltip direction="top">{point.name}</Tooltip>
              <Popup>
                <strong>{point.name}</strong>
                <br />
                <span className="muted">{t(`point.${point.kind}`)}</span>
                {point.description && (
                  <>
                    <br />
                    {point.description}
                  </>
                )}
              </Popup>
            </Marker>
          ))}

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

          {pendingPins.map((pin) => (
            <Marker key={pin.clientId} position={[pin.latitude, pin.longitude]} icon={pendingPinIcon}>
              <Popup>
                <strong>{pin.label}</strong>
                <br />
                <small>{t('map.pinPending')}</small>
                <br />
                <button type="button" className="link danger" onClick={() => removeFromOutbox(pin.clientId)}>
                  {t('common.delete')}
                </button>
              </Popup>
            </Marker>
          ))}

          {friends.data?.map((f) => (
            <Marker key={f.userId} position={[f.latitude, f.longitude]} icon={friendIcon(f.displayName)}>
              <Popup>
                <strong>{f.displayName}</strong>
                <br />
                {online
                  ? t('map.updated', { time: formatRelative(f.recordedAt, locale) })
                  : t('map.lastKnownAt', { time: `${formatTime(f.recordedAt, locale)}, ${formatRelative(f.recordedAt, locale)}` })}
              </Popup>
            </Marker>
          ))}

          {myPosition ? (
            <Marker position={[myPosition.latitude, myPosition.longitude]} icon={meIcon}>
              <Tooltip>{t('map.you')}</Tooltip>
            </Marker>
          ) : (
            lastPosition && (
              <Marker position={[lastPosition.data.latitude, lastPosition.data.longitude]} icon={meLastIcon}>
                <Popup>
                  <strong>{t('map.you')}</strong>
                  <br />
                  {t('map.lastKnownAt', { time: `${formatTime(lastPosition.savedAt, locale)}, ${formatRelative(lastPosition.savedAt, locale)}` })}
                </Popup>
              </Marker>
            )
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
        {pinError && (
          <p className="map-note" role="alert">
            {t(pinError)}
          </p>
        )}
        {notLive && <p className="map-note" role="status">{t('map.notLive')}</p>}
        {!online && stages.savedAt && <p className="map-note">{t('map.offlineData', { time: formatTime(stages.savedAt, locale) })}</p>}
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
