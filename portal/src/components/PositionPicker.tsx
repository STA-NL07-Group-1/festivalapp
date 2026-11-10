// Kaart om een positie te kiezen: klik op de kaart of sleep de marker.
// Toont ook de podia en de bestaande kaartpunten, zodat je ziet waar je bent.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { MapPoint, Stage } from '../api/client'

export interface Position {
  latitude: number
  longitude: number
}

// Zelfde kaart als in de app: CARTO met sleutel, anders OpenStreetMap
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined)?.trim()

// Eigen markers met HTML, zodat we geen afbeeldingen van Leaflet nodig hebben
const chosenIcon = L.divIcon({ className: 'picker-chosen', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] })
const existingIcon = L.divIcon({ className: 'picker-existing', html: '<span></span>', iconSize: [14, 14], iconAnchor: [7, 7] })

function ClickToChoose({ onChoose }: { onChoose: (position: Position) => void }) {
  useMapEvents({
    click(e) {
      onChoose({ latitude: e.latlng.lat, longitude: e.latlng.lng })
    },
  })
  return null
}

/** Schuift de kaart naar de gekozen positie als die buiten beeld valt (bijv. na "mijn locatie"). */
function KeepInView({ position }: { position: Position | null }) {
  const map = useMap()
  useEffect(() => {
    if (!position) return
    const point = L.latLng(position.latitude, position.longitude)
    if (!map.getBounds().contains(point)) map.setView(point, Math.max(map.getZoom(), 17))
  }, [map, position])
  return null
}

interface Props {
  value: Position | null
  onChange: (position: Position) => void
  stages: Stage[]
  points: MapPoint[]
  /** Punt dat je nu bewerkt: dat tonen we niet als "bestaand punt" */
  editingId?: string
}

export function PositionPicker({ value, onChange, stages, points, editingId }: Props) {
  // Begin bij de podia; zonder podia bij de bestaande punten; anders midden in Nederland
  const anchors: Position[] = stages.length > 0 ? stages : points
  const center: [number, number] =
    anchors.length > 0
      ? [anchors.reduce((sum, a) => sum + a.latitude, 0) / anchors.length, anchors.reduce((sum, a) => sum + a.longitude, 0) / anchors.length]
      : [52.2, 5.3]

  return (
    <MapContainer center={value ? [value.latitude, value.longitude] : center} zoom={anchors.length > 0 ? 17 : 8} className="picker-map">
      {CARTO_KEY ? (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={`https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_KEY)}`}
          maxZoom={20}
        />
      ) : (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
      )}
      <ClickToChoose onChoose={onChange} />
      <KeepInView position={value} />

      {stages.map((stage) => (
        <CircleMarker key={stage.id} center={[stage.latitude, stage.longitude]} radius={16} pathOptions={{ color: '#8e2bd6', fillOpacity: 0.2, weight: 2 }} interactive={false}>
          <Tooltip direction="top" permanent>
            {stage.name}
          </Tooltip>
        </CircleMarker>
      ))}

      {points
        .filter((p) => p.id !== editingId)
        .map((p) => (
          <Marker key={p.id} position={[p.latitude, p.longitude]} icon={existingIcon} interactive={false}>
            <Tooltip direction="top">{p.name}</Tooltip>
          </Marker>
        ))}

      {value && (
        <Marker
          position={[value.latitude, value.longitude]}
          icon={chosenIcon}
          draggable
          eventHandlers={{
            dragend(e) {
              const at = (e.target as L.Marker).getLatLng()
              onChange({ latitude: at.lat, longitude: at.lng })
            },
          }}
        />
      )}
    </MapContainer>
  )
}
