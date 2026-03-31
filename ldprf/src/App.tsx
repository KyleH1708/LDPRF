import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

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
  remarks: string
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

const createTrackMarker = (track: Track) => {
  const color = classificationColor(track.classification)
  const symbolHtml = `<div style="width: 20px; height: 20px; background-color: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.8); margin: 0 auto;"></div>`
  const remarksHtml = track.remarks ? `<div>Remarks: ${track.remarks}</div>` : ''
  const labelHtml = `
    <div style="background: none; color: black; padding: 8px 6px; border-radius: 4px; margin-top: 2px; font-size: 14px; text-align: center; line-height: 1.4;">
      ${remarksHtml}
      <div><strong>${track.label}</strong></div>
      <div>Height: ${track.height} ft</div>
    </div>
  `
  const html = `<div style="display: flex; flex-direction: column; align-items: center;">${symbolHtml}${labelHtml}</div>`

  return L.divIcon({
    className: 'track-marker',
    html: html,
    iconAnchor: [10, 60], // Adjust anchor to account for label height
    iconSize: [20, 100], // Adjust size to fit symbol + label
  })
}

function App() {
  const [unit, setUnit] = useState<Unit>('km')
  const [bulleye, setBulleye] = useState<Bulleye>({ name: 'BULLSEYE', lat: 28.9658, lng: 47.7452 })

  const [bulleyeForm, setBulleyeForm] = useState({ name: 'BULLSEYE', lat: 28.9658, lng: 47.7452 })

  const [trackForm, setTrackForm] = useState({
    label: 'T1',
    height: 0,
    speed: 100,
    heading: 0,
    bearing: 0,
    range: 10,
    classification: 'Neutral' as Classification,
    remarks: '',
  })

  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)

  const [trackLog, setTrackLog] = useState<Array<{ timestamp: string; label: string; action: string }>>([])

  const [samForm, setSamForm] = useState({ label: 'SAM1', x: 20, y: -20, range: 40 })

  const [samUIMinimized, setSamUIMinimized] = useState(true)

  const [bulleyeUIMinimized, setBulleyeUIMinimized] = useState(true)

  const [tracks, setTracks] = useState<Track[]>([])
  const [sams, setSams] = useState<SAM[]>([])
  const [nextTrackId, setNextTrackId] = useState(1)
  const [nextSamId, setNextSamId] = useState(1)

  const [cursorInfo, setCursorInfo] = useState<{ bearing: number; range: number; unit: Unit } | null>(null)

  const [trackHistoryPanel, setTrackHistoryPanel] = useState<{ track: Track | null; visible: boolean }>({ track: null, visible: false })

  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)
  const lastUpdateRef = useRef(Date.now())

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
      // Show predicted position 10 seconds ahead
      const distanceIn10Sec = (t.speedKmh / 3600) * 10
      const predDelta = polarToXY(t.heading, distanceIn10Sec)
      const predicted = trackKmToLatLng(bulleye, t.x + predDelta.x, t.y + predDelta.y)

      L.polyline([current, predicted], { color: '#f80', dashArray: '8,6', weight: 2 }).addTo(overlay)

      const marker = L.marker(current, { icon: createTrackMarker(t) })
      marker
        .bindPopup(`${t.label} | h=${t.height} ft | ${fromKm(t.rangeKm, unit).toFixed(1)} ${unit}/ ${t.bearing.toFixed(1)}° | ${t.classification}`)
        .on('click', () => showTrackHistory(t))
        .addTo(overlay)
    })
  }, [tracks, sams, bulleye, unit])

  useEffect(() => {
    if (!supabase) {
      console.log('Supabase not configured. Using local state only.')
      return
    }

    // Load initial tracks from database
    const loadTracks = async () => {
      const { data, error } = await supabase.from('tracks').select('*')
      if (error) {
        console.error('Error loading tracks:', error)
        return
      }
      if (data) {
        const parsedTracks: Track[] = data.map((track: any) => ({
          ...track,
          history: Array.isArray(track.history) ? track.history : JSON.parse(track.history || '[]'),
        }))
        setTracks(parsedTracks)
        // Update nextTrackId to avoid conflicts
        const maxId = Math.max(...parsedTracks.map((t) => t.id), 0)
        setNextTrackId(maxId + 1)
      }
    }

    loadTracks()

    // Set up real-time subscription
    const subscription = supabase
      .channel('tracks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, (payload: any) => {
        if (payload.eventType === 'INSERT') {
          const newTrack = {
            ...payload.new,
            history: Array.isArray(payload.new.history) ? payload.new.history : JSON.parse(payload.new.history || '[]'),
          }
          setTracks((prev) => [...prev, newTrack])
        } else if (payload.eventType === 'UPDATE') {
          const updatedTrack = {
            ...payload.new,
            history: Array.isArray(payload.new.history) ? payload.new.history : JSON.parse(payload.new.history || '[]'),
          }
          setTracks((prev) => prev.map((t) => (t.id === updatedTrack.id ? updatedTrack : t)))
        } else if (payload.eventType === 'DELETE') {
          setTracks((prev) => prev.filter((t) => t.id !== payload.old.id))
        }
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    // Auto-update track positions
    const interval = setInterval(() => {
      const now = Date.now()
      const deltaTimeMs = now - lastUpdateRef.current
      const deltaTimeSec = deltaTimeMs / 1000
      
      const updatedTracks = tracks.map((t) => {
        // Speed is in km/h, distance traveled in this interval
        const distanceKm = (t.speedKmh / 3600) * deltaTimeSec
        // Calculate movement based on heading (0° = north, 90° = east, etc)
        const delta = polarToXY(t.heading, distanceKm)
        const nextX = t.x + delta.x
        const nextY = t.y + delta.y
        const rangeKm = Math.sqrt(nextX * nextX + nextY * nextY)
        const bearing = ((Math.atan2(nextX, nextY) * 180) / Math.PI + 360) % 360
        const newHistory = [...t.history, { x: nextX, y: nextY }]
        if (newHistory.length > 120) newHistory.shift()
        return {
          ...t,
          x: nextX,
          y: nextY,
          rangeKm,
          bearing,
          history: newHistory,
        }
      })

      // Only update if tracks have moved
      if (JSON.stringify(updatedTracks) !== JSON.stringify(tracks)) {
        setTracks(updatedTracks)
        
        // Update position in database if Supabase is configured
        if (supabase) {
          updatedTracks.forEach(async (t) => {
            await supabase
              .from('tracks')
              .update({
                x: t.x,
                y: t.y,
                rangeKm: t.rangeKm,
                bearing: t.bearing,
                history: JSON.stringify(t.history),
              })
              .eq('id', t.id)
          })
        }
      }

      lastUpdateRef.current = now
    }, 1000)

    return () => clearInterval(interval)
  }, [tracks])


  const addTrack = async () => {
    const rangeKm = toKm(trackForm.range, unit)
    // Convert knots to km/h (1 knot = 1.852 km/h)
    const speedKmh = trackForm.speed * 1.852
    const delta = polarToXY(trackForm.bearing, rangeKm)
    const x = delta.x
    const y = delta.y

    const newTrack = {
      label: trackForm.label || `T${nextTrackId}`,
      classification: trackForm.classification,
      height: trackForm.height,
      speedKmh,
      heading: trackForm.heading,
      bearing: trackForm.bearing,
      rangeKm,
      x,
      y,
      history: JSON.stringify([{ x, y }]),
      remarks: trackForm.remarks,
    }

    if (supabase) {
      const { error } = await supabase.from('tracks').insert([newTrack])
      if (error) {
        console.error('Error adding track:', error)
        return
      }
    } else {
      // Fallback: add to local state
      setTracks((prev) => [
        ...prev,
        {
          id: nextTrackId,
          ...newTrack,
          history: [{ x, y }],
        },
      ])
      setNextTrackId((v) => v + 1)
    }

    setTrackLog((prev) => [
      {
        timestamp: new Date().toISOString(),
        label: newTrack.label,
        action: 'added',
      },
      ...prev,
    ])

    // Reset form after adding
    setTrackForm({
      label: 'T1',
      height: 0,
      speed: 100,
      heading: 0,
      bearing: 0,
      range: 10,
      classification: 'Neutral' as Classification,
      remarks: '',
    })
  }

  const updateTrack = async () => {
    if (selectedTrackId === null) return
    console.log('Updating track', selectedTrackId, 'with form data:', trackForm)
    // Convert knots to km/h (1 knot = 1.852 km/h)
    const speedKmh = trackForm.speed * 1.852
    const rangeKm = toKm(trackForm.range, unit)
    const delta = polarToXY(trackForm.bearing, rangeKm)
    const x = delta.x
    const y = delta.y

    const updatedData = {
      label: trackForm.label,
      height: trackForm.height,
      speedKmh,
      heading: trackForm.heading,
      bearing: trackForm.bearing,
      rangeKm,
      x,
      y,
      classification: trackForm.classification,
      remarks: trackForm.remarks,
      history: JSON.stringify([{ x, y }]),
    }

    if (supabase) {
      const { error } = await supabase.from('tracks').update(updatedData).eq('id', selectedTrackId)
      if (error) {
        console.error('Error updating track:', error)
        return
      }
    } else {
      // Fallback: update local state
      setTracks((prev) => {
        const updated = prev.map((t) =>
          t.id === selectedTrackId
            ? {
                ...t,
                ...updatedData,
                history: [{ x, y }],
              }
            : t,
        )
        return updated
      })
    }

    setTrackLog((prev) => [
      {
        timestamp: new Date().toISOString(),
        label: trackForm.label,
        action: 'updated',
      },
      ...prev,
    ])
    setSelectedTrackId(null)
    // Reset form after update
    setTrackForm({
      label: 'T1',
      height: 0,
      speed: 100,
      heading: 0,
      bearing: 0,
      range: 10,
      classification: 'Neutral' as Classification,
      remarks: '',
    })
  }

  const selectTrackToEdit = (track: Track) => {
    console.log('Selecting track to edit:', track)
    setSelectedTrackId(track.id)
    setTrackForm({
      label: track.label,
      height: track.height,
      speed: track.speedKmh / 1.852, // convert back to knots for UI
      heading: track.heading,
      bearing: track.bearing,
      range: fromKm(track.rangeKm, unit),
      classification: track.classification,
      remarks: track.remarks,
    })
    console.log('Form set to:', {
      label: track.label,
      classification: track.classification,
      remarks: track.remarks,
    })
  }

  const deleteTrack = async (id: number) => {
    if (supabase) {
      const { error } = await supabase.from('tracks').delete().eq('id', id)
      if (error) {
        console.error('Error deleting track:', error)
        return
      }
    } else {
      // Fallback: delete from local state
      setTracks((prev) => prev.filter((t) => t.id !== id))
    }

    setTrackLog((prev) => [
      {
        timestamp: new Date().toISOString(),
        label: `T${id}`,
        action: 'deleted',
      },
      ...prev,
    ])
    if (selectedTrackId === id) {
      setSelectedTrackId(null)
    }
  }

  const showTrackHistory = (track: Track) => {
    setTrackHistoryPanel({ track, visible: true })
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
            <h2>Add Track</h2>
            <label>
              Track ID
              <input value={trackForm.label} onChange={(e) => setTrackForm((f) => ({ ...f, label: e.target.value }))} />
            </label>
            <label>
              Classification
              <select value={trackForm.classification} onChange={(e) => setTrackForm((f) => ({ ...f, classification: e.target.value as Classification }))}>
                <option value="Friend">Friend</option>
                <option value="Neutral">Neutral</option>
                <option value="Suspect">Suspect</option>
                <option value="Unknown">Unknown</option>
                <option value="Hostile">Hostile</option>
              </select>
            </label>
            <label>
              Height (ft)
              <input type="number" value={trackForm.height} onChange={(e) => setTrackForm((f) => ({ ...f, height: Number(e.target.value) }))} />
            </label>
            <label>
              Speed (knots)
              <input type="number" value={trackForm.speed} onChange={(e) => setTrackForm((f) => ({ ...f, speed: Math.max(0, Number(e.target.value)) }))} />
            </label>
            <label>
              Heading (°) [0°=N, 90°=E, 180°=S, 270°=W]
              <input type="number" min="0" max="359" value={trackForm.heading} onChange={(e) => setTrackForm((f) => ({ ...f, heading: Number(e.target.value) % 360 }))} />
            </label>
            <label>
              Bearing from Bullseye (°)
              <input type="number" value={trackForm.bearing} onChange={(e) => setTrackForm((f) => ({ ...f, bearing: Number(e.target.value) }))} />
            </label>
            <label>
              Range from Bullseye ({unitLabel})
              <input type="number" value={trackForm.range} onChange={(e) => setTrackForm((f) => ({ ...f, range: Number(e.target.value) }))} />
            </label>
            <label>
              Remarks
              <input value={trackForm.remarks} onChange={(e) => setTrackForm((f) => ({ ...f, remarks: e.target.value }))} />
            </label>
            <div className="track-buttons">
              <button onClick={addTrack} disabled={selectedTrackId !== null}>Add Track</button>
              <button onClick={updateTrack} disabled={selectedTrackId === null}>Update Selected</button>
            </div>
          </section>

          <section className="panel-block">
            <h2 onClick={() => setSamUIMinimized(!samUIMinimized)} style={{ cursor: 'pointer' }}>
              Add SAM {samUIMinimized ? '+' : '-'}
            </h2>
            {!samUIMinimized && (
              <>
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
              </>
            )}
          </section>

          <section className="panel-block panel-list">
            <h2>Track List</h2>
            <ul>
              {tracks.map((t) => (
                <li key={t.id} className={selectedTrackId === t.id ? 'selected' : ''}>
                  <div onClick={() => selectTrackToEdit(t)} style={{ cursor: 'pointer' }}>
                    {t.label}: h={t.height}ft sp={(t.speedKmh / 1.852).toFixed(1)} knots, r={fromKm(t.rangeKm, unit).toFixed(1)} {unitLabel}, b={t.bearing.toFixed(1)}° ({t.classification})
                    {t.remarks && <div>Remarks: {t.remarks}</div>}
                  </div>
                  <button onClick={() => deleteTrack(t.id)} style={{ marginLeft: '10px', fontSize: '0.8rem' }}>Delete</button>
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

          <section className="panel-block">
            <h2 onClick={() => setBulleyeUIMinimized(!bulleyeUIMinimized)} style={{ cursor: 'pointer' }}>
              Bullseye gps coords {bulleyeUIMinimized ? '+' : '-'}
            </h2>
            {!bulleyeUIMinimized && (
              <>
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
              </>
            )}
          </section>
        </aside>

        <main className="map-frame">
          <div ref={mapRef} style={{ height: '100%', width: '100%' }} />
        </main>

        {trackHistoryPanel.visible && trackHistoryPanel.track && (
          <aside className="panel right-panel">
            <section className="panel-block">
              <h2>Track History: {trackHistoryPanel.track.label}</h2>
              <button onClick={() => setTrackHistoryPanel({ track: null, visible: false })}>Close</button>
              <div>
                <strong>Current Position:</strong> x={trackHistoryPanel.track.x.toFixed(2)} km, y={trackHistoryPanel.track.y.toFixed(2)} km
              </div>
              <div>
                <strong>Remarks:</strong> {trackHistoryPanel.track.remarks || 'None'}
              </div>
              <div>
                <strong>Updates:</strong>
                <ul>
                  {trackLog.filter(entry => entry.label === trackHistoryPanel.track!.label).map((entry, idx) => (
                    <li key={idx}>
                      [{new Date(entry.timestamp).toLocaleString()}] {entry.action}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}

export default App
