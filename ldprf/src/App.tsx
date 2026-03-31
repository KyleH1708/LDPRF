import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

type Unit = 'km' | 'nm'

type Classification = 'Friend' | 'Neutral' | 'Hostile' | 'Suspect' | 'Unknown'

type Track = {
  id: number
  label: string
  // Link16 classification semantics
  classification: Classification
  height: number
  speedKmh: number
  heading: number
  bearing: number
  rangeKm: number
  x: number // east km from bullseye
  y: number // north km from bullseye
  history: Array<{ x: number; y: number }>
}

type SAM = {
  id: number
  label: string
  x: number
  y: number
  rangeKm: number
}

type Bulleye = {
  name: string
  lat: number
  lng: number
}

const toKm = (value: number, unit: Unit) => (unit === 'nm' ? value * 1.852 : value)
const fromKm = (value: number, unit: Unit) => (unit === 'nm' ? value / 1.852 : value)

function polarToXY(bearing: number, rangeKm: number) {
  const rad = (bearing * Math.PI) / 180
  const dx = rangeKm * Math.sin(rad)
  const dy = rangeKm * Math.cos(rad)
  return { x: dx, y: dy }
}

const trackKmToLatLng = (bull: Bulleye, x: number, y: number) => {
  const lat = bull.lat + y / 111
  const lon = bull.lng + x / (111 * Math.cos((bull.lat * Math.PI) / 180))
  return [lat, lon] as [number, number]
}

const latLngToTrack = (bull: Bulleye, lat: number, lng: number) => {
  const dy = (lat - bull.lat) * 111
  const dx = (lng - bull.lng) * 111 * Math.cos((bull.lat * Math.PI) / 180)
  const rangeKm = Math.sqrt(dx * dx + dy * dy)
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  return { dx, dy, bearing, rangeKm }
}

const classificationColor = (classification: Classification) => {
  switch (classification) {
    case 'Friend':
      return '#0af'
    case 'Neutral':
      return '#0f0' // green for neutral
    case 'Suspect':
      return '#ffa500' // orange
    case 'Unknown':
      return '#ffca28' // yellow
    case 'Hostile':
      return '#f00'
  }
}

const createApp6Symbol = (classification: Classification) => {
  const color = classificationColor(classification)
  const iconHtml = {
    Friend: `<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#fff" stroke-width="2" /></svg>`,
    Neutral: `<svg viewBox="0 0 24 24" width="24" height="24"><polygon points="12,4 20,12 12,20 4,12" fill="${color}" stroke="#000" stroke-width="1.5" /></svg>`,
    Suspect: `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="6" y="6" width="12" height="12" fill="${color}" stroke="#000" stroke-width="1.5" /></svg>`,
    Unknown: `<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="#000" stroke-width="1.5" /></svg>`,
    Hostile: `<svg viewBox="0 0 24 24" width="24" height="24"><polygon points="12,3 20,21 4,21" fill="${color}" stroke="#000" stroke-width="1.5" /></svg>`,
  }[classification]

  return L.divIcon({
    className: 'app6-symbol',
    html: iconHtml,
    iconAnchor: [12, 12],
    iconSize: [24, 24],
  })
}

function App() {
  const [unit, setUnit] = useState<Unit>('km')
  const [bulleye, setBulleye] = useState<Bulleye>({ name: 'BULLSEYE', lat: 28.9658, lng: 47.4452 })

  const [bulleyeForm, setBulleyeForm] = useState({ name: 'BULLSEYE', lat: 28.9658, lng: 47.4452 })

  const [trackForm, setTrackForm] = useState({
    label: 'T1',
    height: 15000,
    speed: 450,
    heading: 90,
    bearing: 45,
    range: 100,
    classification: 'neutral' as Classification,
  })

  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)

  const [trackLog, setTrackLog] = useState<Array<{ timestamp: string; label: string; action: string }>>([])

  const [samForm, setSamForm] = useState({ label: 'SAM1', x: 20, y: -20, range: 40 })

  const [tracks, setTracks] = useState<Track[]>([])
  const [sams, setSams] = useState<SAM[]>([])
  const [nextTrackId, setNextTrackId] = useState(1)
  const [nextSamId, setNextSamId] = useState(1)

  const [cursorInfo, setCursorInfo] = useState<{ bearing: number; range: number; unit: Unit } | null>(null)

  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return
    const map = L.map(mapRef.current, {
      center: [bulleye.lat, bulleye.lng],
      zoom: 8,
      zoomControl: true,
    })

    const updateCursor = (event: L.LeafletMouseEvent) => {
      const latlng = event.latlng
      const info = latLngToTrack(bulleye, latlng.lat, latlng.lng)
      const range = unit === 'km' ? info.rangeKm : info.rangeKm / 1.852
      setCursorInfo({ bearing: info.bearing, range, unit })
    }

    map.on('mousemove', updateCursor)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    overlayRef.current = L.layerGroup().addTo(map)
    leafletMapRef.current = map

    return () => {
      map.off('mousemove')
      map.remove()
      leafletMapRef.current = null
      overlayRef.current = null
    }
  }, [])

  useEffect(() => {
    if (leafletMapRef.current) {
      leafletMapRef.current.setView([bulleye.lat, bulleye.lng], 8)
    }
  }, [bulleye.lat, bulleye.lng])

  useEffect(() => {
    if (!leafletMapRef.current) return
    const map = leafletMapRef.current

    const updateCursor = (event: L.LeafletMouseEvent) => {
      const latlng = event.latlng
      const info = latLngToTrack(bulleye, latlng.lat, latlng.lng)
      const range = unit === 'km' ? info.rangeKm : info.rangeKm / 1.852
      setCursorInfo({ bearing: info.bearing, range, unit })
    }

    map.on('mousemove', updateCursor)
    return () => {
      map.off('mousemove', updateCursor)
    }
  }, [bulleye, unit])

  useEffect(() => {
    if (!overlayRef.current) return

    const overlay = overlayRef.current
    overlay.clearLayers()

    const bullMarker = L.circleMarker([bulleye.lat, bulleye.lng], {
      radius: 6,
      color: '#fff',
      fillColor: '#ff0',
      fillOpacity: 1,
    }).bindPopup(`Bullseye: ${bulleye.name}`)
    bullMarker.addTo(overlay)

    const maxRing = 120
    const step = 10
    const unitMultiplier = unit === 'km' ? 1000 : 1852
    const displayUnit = unit === 'km' ? 'km' : 'nm'
    for (let n = step; n <= maxRing; n += step) {
      L.circle([bulleye.lat, bulleye.lng], {
        radius: n * unitMultiplier,
        color: '#33f',
        weight: 1,
        fillOpacity: 0,
        opacity: 0.45,
      })
        .bindPopup(`${n} ${displayUnit} ring`)
        .addTo(overlay)
    }

    sams.forEach((s) => {
      const pos = trackKmToLatLng(bulleye, s.x, s.y)
      L.circleMarker(pos, {
        radius: 5,
        color: '#0f0',
        fillColor: '#0f0',
        fillOpacity: 0.8,
      })
        .bindPopup(`${s.label}`)
        .addTo(overlay)

      L.circle(pos, {
        radius: s.rangeKm * 1000,
        color: '#0f0',
        weight: 1,
        fillOpacity: 0.06,
      }).addTo(overlay)
    })

    tracks.forEach((t) => {
      const historyPoints = t.history.map((h) => trackKmToLatLng(bulleye, h.x, h.y))
      if (historyPoints.length > 1) {
        L.polyline(historyPoints, { color: '#ffc045', weight: 2, opacity: 0.7 }).addTo(overlay)
      }

      const current = trackKmToLatLng(bulleye, t.x, t.y)
      const predDelta = polarToXY(t.speedKmh / 60, t.heading)
      const predicted = trackKmToLatLng(bulleye, t.x + predDelta.x, t.y + predDelta.y)

      L.polyline([current, predicted], { color: '#f80', dashArray: '8,6', weight: 2 }).addTo(overlay)

      const marker = L.marker(current, {
        icon: createApp6Symbol(t.classification),
      })
      marker
        .bindPopup(`${t.label} | h=${t.height} ft | ${fromKm(t.rangeKm, unit).toFixed(1)} ${unit}/ ${t.bearing.toFixed(1)}° | ${t.classification}`)
        .on('click', () => selectTrackToEdit(t))
        .addTo(overlay)
    })
  }, [tracks, sams, bulleye, unit])

  useEffect(() => {
    const interval = setInterval(() => {
      setTracks((current) =>
        current.map((t) => {
          const distanceKm = t.speedKmh / 3600
          const delta = polarToXY(distanceKm, t.heading)
          const nextX = t.x + delta.x
          const nextY = t.y + delta.y
          const rangeKm = Math.sqrt(nextX * nextX + nextY * nextY)
          const bearing = (Math.atan2(nextX, nextY) * 180) / Math.PI
          const newHistory = [...t.history, { x: nextX, y: nextY }]
          if (newHistory.length > 120) newHistory.shift()
          return {
            ...t,
            x: nextX,
            y: nextY,
            rangeKm,
            bearing: (bearing + 360) % 360,
            history: newHistory,
          }
        }),
      )
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const addTrack = () => {
    const rangeKm = toKm(trackForm.range, unit)
    const speedKmh = toKm(trackForm.speed, unit)
    const delta = polarToXY(rangeKm, trackForm.bearing)
    const x = delta.x
    const y = delta.y

    setTracks((prev) => [
      ...prev,
      {
        id: nextTrackId,
        label: trackForm.label || `T${nextTrackId}`,
        height: trackForm.height,
        speedKmh,
        heading: trackForm.heading,
        bearing: trackForm.bearing,
        classification: trackForm.classification,
        rangeKm,
        x,
        y,
        history: [{ x, y }],
      },
    ])
    setTrackLog((prev) => [
      {
        timestamp: new Date().toISOString(),
        label: trackForm.label || `T${nextTrackId}`,
        action: 'added',
      },
      ...prev,
    ])
    setNextTrackId((v) => v + 1)
  }

  const updateTrack = () => {
    if (selectedTrackId === null) return
    const newX = polarToXY(toKm(trackForm.range, unit), trackForm.bearing).x
    const newY = polarToXY(toKm(trackForm.range, unit), trackForm.bearing).y
    setTracks((prev) =>
      prev.map((t) =>
        t.id === selectedTrackId
          ? {
              ...t,
              label: trackForm.label || t.label,
              height: trackForm.height,
              speedKmh: toKm(trackForm.speed, unit),
              heading: trackForm.heading,
              bearing: trackForm.bearing,
              classification: trackForm.classification,
              rangeKm: toKm(trackForm.range, unit),
              x: newX,
              y: newY,
              history: [...t.history, { x: newX, y: newY }].slice(-120),
            }
          : t,
      ),
    )
    setTrackLog((prev) => [
      {
        timestamp: new Date().toISOString(),
        label: trackForm.label || `T${selectedTrackId}`,
        action: 'updated',
      },
      ...prev,
    ])
    setSelectedTrackId(null)
  }

  const selectTrackToEdit = (track: Track) => {
    setSelectedTrackId(track.id)
    setTrackForm({
      label: track.label,
      height: track.height,
      speed: fromKm(track.speedKmh, unit),
      heading: track.heading,
      bearing: track.bearing,
      range: fromKm(track.rangeKm, unit),
      classification: track.classification,
    })
  }

  const addSAM = () => {
    const x = toKm(samForm.x, unit)
    const y = toKm(samForm.y, unit)
    const rangeKm = toKm(samForm.range, unit)

    setSams((prev) => [
      ...prev,
      { id: nextSamId, label: samForm.label, x, y, rangeKm },
    ])
    setNextSamId((v) => v + 1)
  }

  const updateBulleye = () => {
    setBulleye({ name: bulleyeForm.name || 'BULLSEYE', lat: bulleyeForm.lat, lng: bulleyeForm.lng })

    setTracks((current) =>
      current.map((t) => {
        const rangeKm = Math.sqrt(t.x * t.x + t.y * t.y)
        const bearing = (Math.atan2(t.x, t.y) * 180) / Math.PI
        return { ...t, rangeKm, bearing: (bearing + 360) % 360 }
      }),
    )
  }

  const unitLabel = unit === 'km' ? 'km' : 'nm'

  return (
    <div className="tac-app">
      <header>
        <h1>Tactical C2 (Kuwait)</h1>
        <div className="unit-toggle">
          <span>Distance units:</span>
          <button onClick={() => setUnit('km')} className={unit === 'km' ? 'active' : ''}>
            KM
          </button>
          <button onClick={() => setUnit('nm')} className={unit === 'nm' ? 'active' : ''}>
            NM
          </button>
        </div>
        <div className="cursor-info">
          {cursorInfo ? (
            <span>
              Cursor: {cursorInfo.bearing.toFixed(1)}°, {cursorInfo.range.toFixed(2)} {cursorInfo.unit}
            </span>
          ) : (
            <span>Cursor: move over map</span>
          )}
        </div>
      </header>

      <div className="layout">
        <aside className="panel">
          <section className="panel-block">
            <h2>Bullseye gps coords</h2>
            <label>
              Name
              <input value={bulleyeForm.name} onChange={(e) => setBulleyeForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label>
              Lat
              <input type="number" value={bulleyeForm.lat} onChange={(e) => setBulleyeForm((f) => ({ ...f, lat: Number(e.target.value) }))} />
            </label>
            <label>
              Lng
              <input type="number" value={bulleyeForm.lng} onChange={(e) => setBulleyeForm((f) => ({ ...f, lng: Number(e.target.value) }))} />
            </label>
            <button onClick={updateBulleye}>Set Bullseye</button>
          </section>

          <section className="panel-block">
            <h2>Add Track</h2>
            <label>
              Track ID
              <input value={trackForm.label} onChange={(e) => setTrackForm((f) => ({ ...f, label: e.target.value }))} />
            </label>
            <label>
              Classification (Link16 semantics)
              <select value={trackForm.classification} onChange={(e) => setTrackForm((f) => ({ ...f, classification: e.target.value as Classification }))}>
                <option value="friend">friend</option>
                <option value="neutral">neutral</option>
                <option value="suspect">suspect</option>
                <option value="unknown">unknown</option>
                <option value="hostile">hostile</option>
              </select>
            </label>
            <label>
              Height (ft)
              <input type="number" value={trackForm.height} onChange={(e) => setTrackForm((f) => ({ ...f, height: Number(e.target.value) }))} />
            </label>
            <label>
              Speed ({unitLabel}/h)
              <input type="number" value={trackForm.speed} onChange={(e) => setTrackForm((f) => ({ ...f, speed: Number(e.target.value) }))} />
            </label>
            <label>
              Heading (°)
              <input type="number" value={trackForm.heading} onChange={(e) => setTrackForm((f) => ({ ...f, heading: Number(e.target.value) }))} />
            </label>
            <label>
              Bearing from Bullseye (°)
              <input type="number" value={trackForm.bearing} onChange={(e) => setTrackForm((f) => ({ ...f, bearing: Number(e.target.value) }))} />
            </label>
            <label>
              Classification
              <select value={trackForm.classification} onChange={(e) => setTrackForm((f) => ({ ...f, classification: e.target.value as Classification }))}>
                <option value="friend">friend</option>
                <option value="neutral">neutral</option>
                <option value="hostile">hostile</option>
              </select>
            </label>
            <label>
              Range from Bullseye ({unitLabel})
              <input type="number" value={trackForm.range} onChange={(e) => setTrackForm((f) => ({ ...f, range: Number(e.target.value) }))} />
            </label>
            <div className="track-buttons">
              <button onClick={addTrack} disabled={selectedTrackId !== null}>Add Track</button>
              <button onClick={updateTrack} disabled={selectedTrackId === null}>Update Selected</button>
            </div>
          </section>

          <section className="panel-block">
            <h2>Add SAM</h2>
            <label>
              Name
              <input value={samForm.label} onChange={(e) => setSamForm((f) => ({ ...f, label: e.target.value }))} />
            </label>
            <label>
              X offset (km east)
              <input type="number" value={samForm.x} onChange={(e) => setSamForm((f) => ({ ...f, x: Number(e.target.value) }))} />
            </label>
            <label>
              Y offset (km north)
              <input type="number" value={samForm.y} onChange={(e) => setSamForm((f) => ({ ...f, y: Number(e.target.value) }))} />
            </label>
            <label>
              Range ({unitLabel})
              <input type="number" value={samForm.range} onChange={(e) => setSamForm((f) => ({ ...f, range: Number(e.target.value) }))} />
            </label>
            <button onClick={addSAM}>Add SAM</button>
          </section>

          <section className="panel-block panel-list">
            <h2>Track List</h2>
            <ul>
              {tracks.map((t) => (
                <li key={t.id} onClick={() => selectTrackToEdit(t)} className={selectedTrackId === t.id ? 'selected' : ''}>
                  {t.label}: h={t.height}ft sp={fromKm(t.speedKmh, unit).toFixed(1)} {unitLabel}/h, r={fromKm(t.rangeKm, unit).toFixed(1)} {unitLabel}, b={t.bearing.toFixed(1)}° ({t.classification})
                </li>
              ))}
            </ul>
          </section>

          <section className="panel-block panel-list">
            <h2>SAM List</h2>
            <ul>
              {sams.map((s) => (
                <li key={s.id}>
                  {s.label}: x={fromKm(s.x, unit).toFixed(1)} {unitLabel}, y={fromKm(s.y, unit).toFixed(1)} {unitLabel}, r={fromKm(s.rangeKm, unit).toFixed(1)} {unitLabel}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel-block panel-list">
            <h2>Track Input Log</h2>
            <ul>
              {trackLog.map((entry, idx) => (
                <li key={`${entry.timestamp}-${idx}`}>
                  [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.label} {entry.action}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="map-frame">
          <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
        </main>
      </div>
    </div>
  )
}

export default App
