"use client"

import { useEffect, useMemo, useRef, useState } from "react"

// Types
type LineStatus = "Healthy" | "Fault" | "Shutoff"
type LTLine = { id: string; name: string; coords: [number, number][]; status: LineStatus }
type NotificationItem = { id: string; ts: number; lineId: string; message: string; status: LineStatus }

// Utilities
const now = () => Date.now()
const formatTime = (ts: number) => new Date(ts).toLocaleString(undefined, { hour12: true })

// Color mapping
const statusColors: Record<LineStatus, { stroke: string; fill: string; dashArray?: string }> = {
  Healthy: { stroke: "#22c55e", fill: "#22c55e" }, // green
  Fault: { stroke: "#ef4444", fill: "#ef4444" }, // red
  Shutoff: { stroke: "#6b7280", fill: "#6b7280", dashArray: "6 6" }, // grey
}

// Mock lines (Kerala region approximate)
const initialLines: LTLine[] = [
  {
    id: "lt-1",
    name: "LT Line - Trivandrum North",
    coords: [
      [8.508, 76.956],
      [8.545, 76.98],
      [8.58, 76.99],
    ],
    status: "Healthy",
  },
  {
    id: "lt-2",
    name: "LT Line - Kochi Coastal",
    coords: [
      [9.94, 76.27],
      [9.97, 76.31],
      [10.02, 76.32],
      [10.06, 76.34],
    ],
    status: "Healthy",
  },
  {
    id: "lt-3",
    name: "LT Line - Kozhikode Rural",
    coords: [
      [11.24, 75.77],
      [11.28, 75.8],
      [11.31, 75.83],
    ],
    status: "Shutoff",
  },
]

export default function KseblDashboard() {
  // State
  const [lines, setLines] = useState<LTLine[]>(initialLines)
  const [selectedLineId, setSelectedLineId] = useState<string>(initialLines[0].id)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Leaflet / Map refs
  const mapRef = useRef<any>(null)
  const leafletRef = useRef<any>(null)
  const layersRef = useRef<Record<string, { polyline: any; marker: any }>>({})
  const hiddenLinesRef = useRef<Set<string>>(new Set())

  // Reports
  const report = useMemo(() => {
    const counts = { Healthy: 0, Fault: 0, Shutoff: 0 } as Record<LineStatus, number>
    for (const l of lines) counts[l.status]++
    const total = lines.length || 1
    const uptime = ((counts.Healthy * 99.5 + counts.Fault * 70) / total).toFixed(1)
    return { counts, total, uptime }
  }, [lines])

  // Lazy load Leaflet
  useEffect(() => {
    const el = document.getElementById("ksebl-map")
    if (!el) return

    // Inject Leaflet CSS once
    if (!document.querySelector('link[data-leaflet="css"]')) {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      link.crossOrigin = ""
      link.setAttribute("data-leaflet", "css")
      document.head.appendChild(link)
    }

    const observer = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.disconnect()
          try {
            const L = await import("leaflet")
            leafletRef.current = L
            initMap(L)
          } catch (e) {
            console.error("[v0] Leaflet load error:", e)
            setMapError("Failed to load map library. Please check your connection and retry.")
          }
        }
      },
      { threshold: 0.2 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function initMap(L: any) {
    if (mapRef.current) return
    try {
      const map = L.map("ksebl-map", {
        center: [10.2, 76.3],
        zoom: 7.5,
        zoomControl: true,
        preferCanvas: true,
      })
      mapRef.current = map

      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      })
      tiles
        .on("tileerror", () => setMapError("Map tiles failed to load. Please check network or try again."))
        .on("load", () => {
          setMapLoaded(true)
          setMapError(null)
        })
        .addTo(map)

      // Draw lines
      for (const line of lines) addOrUpdateLineLayer(line)
      fitBoundsToLines()

      // Basic accessibility hint
      map.once("focus", () => addNotification("system", "Map ready. Use + and - to zoom.", "Healthy"))
    } catch (e) {
      console.error("[v0] Map init error:", e)
      setMapError("Failed to initialize the map. Please retry.")
    }
  }

  function addOrUpdateLineLayer(line: LTLine) {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return

    const colors = statusColors[line.status]
    const existing = layersRef.current[line.id]
    if (existing) {
      existing.polyline.remove?.()
      existing.marker.remove?.()
    }

    // Create layers (attach to map only if visible)
    const polyline = L.polyline(line.coords, {
      color: colors.stroke,
      weight: 4,
      opacity: 0.9,
      dashArray: colors.dashArray || undefined,
    })
    const midIdx = Math.floor(line.coords.length / 2)
    const mid = line.coords[midIdx]
    const marker = L.circleMarker(mid, {
      radius: 7,
      color: colors.stroke,
      fillColor: colors.fill,
      fillOpacity: 0.9,
      weight: 2,
    }).bindPopup(
      `<strong>${line.name}</strong><br/>Status: ${line.status}<br/><span style="color:#a3a3a3">Updated: ${formatTime(
        now(),
      )}</span>`,
    )

    const isHidden = hiddenLinesRef.current.has(line.id)
    if (!isHidden) {
      polyline.addTo(map)
      marker.addTo(map)
    }

    layersRef.current[line.id] = { polyline, marker }
  }

  function fitBoundsToLines() {
    const L = leafletRef.current
    const map = mapRef.current
    if (!L || !map) return
    const bounds = L.latLngBounds([])
    lines.forEach((l) => l.coords.forEach((c) => bounds.extend(c as any)))
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.1))
  }

  // Notifications
  function addNotification(lineId: string, message: string, status: LineStatus) {
    setNotifications((prev) =>
      [{ id: `${now()}-${Math.random()}`, ts: now(), lineId, message, status }, ...prev].slice(0, 20),
    )
  }

  // Update status (let useEffect sync layers to avoid double re-add)
  function updateLineStatus(lineId: string, status: LineStatus) {
    const lineName = lines.find((l) => l.id === lineId)?.name ?? "Line"
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, status } : l)))
    addNotification(lineId, `${lineName} status changed to ${status}`, status)
  }

  // Show/Hide line with persistence
  function toggleLineVisibility(lineId: string, visible: boolean) {
    const map = mapRef.current
    const layers = layersRef.current[lineId]
    if (!map || !layers) return

    if (visible) {
      hiddenLinesRef.current.delete(lineId)
      layers.polyline.addTo(map)
      layers.marker.addTo(map)
    } else {
      hiddenLinesRef.current.add(lineId)
      map.removeLayer(layers.polyline)
      map.removeLayer(layers.marker)
    }
  }

  // Simulate a random fault
  function simulateFault() {
    const candidates = lines.filter((l) => l.status !== "Fault")
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    if (pick) updateLineStatus(pick.id, "Fault")
  }

  // Download CSV
  function downloadCSV() {
    const headers = ["Line ID", "Name", "Status"]
    const rows = lines.map((l) => [l.id, l.name, l.status])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ksebl-lt-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Retry map load
  function retryMap() {
    setMapError(null)
    const L = leafletRef.current
    const map = mapRef.current
    if (L && map) {
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      })
      tiles
        .on("tileerror", () => setMapError("Map tiles failed to load. Please check network or try again."))
        .on("load", () => {
          setMapLoaded(true)
          setMapError(null)
        })
        .addTo(map)
    } else {
      ;(async () => {
        try {
          const L2 = await import("leaflet")
          leafletRef.current = L2
          initMap(L2)
        } catch (e) {
          console.error("[v0] Leaflet retry error:", e)
          setMapError("Failed to load map library. Please retry.")
        }
      })()
    }
  }

  // Sync layers whenever lines change
  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return
    lines.forEach(addOrUpdateLineLayer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  return (
    <section aria-labelledby="dashboard-title" className="mx-auto max-w-6xl px-4 py-6">
      <h2 id="dashboard-title" className="sr-only">
        Dashboard
      </h2>

      {/* Error Banner */}
      {mapError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 p-3 flex items-center justify-between"
        >
          <span className="text-sm">{mapError}</span>
          <button
            className="ml-4 inline-flex items-center rounded-md bg-red-500/20 px-3 py-1.5 text-sm font-medium hover:bg-red-500/30"
            onClick={retryMap}
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map Card */}
        <div className="lg:col-span-2 rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <h3 className="text-lg font-bold">Live Map</h3>
            <span className="text-xs text-neutral-400">{mapLoaded ? "Connected" : "Loading..."}</span>
          </div>
          <div className="p-4">
            <div
              id="ksebl-map"
              role="application"
              aria-label="Kerala LT Lines Map"
              className="h-72 md:h-[520px] w-full rounded-md overflow-hidden border border-neutral-800"
            />
            <p className="mt-3 text-xs text-neutral-400">
              Marker colors: <span className="text-emerald-400 font-medium">Green</span> = Healthy,{" "}
              <span className="text-red-400 font-medium">Red</span> = Fault,{" "}
              <span className="text-neutral-400 font-medium">Grey</span> = Shutoff
            </p>
          </div>
        </div>

        {/* Control Panel */}
        <aside className="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div className="px-4 py-3 border-b border-neutral-800">
            <h3 className="text-lg font-bold">Control Panel</h3>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="line-select" className="block text-sm text-neutral-300 mb-1">
                Select LT Line
              </label>
              <select
                id="line-select"
                className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm"
                value={selectedLineId}
                onChange={(e) => setSelectedLineId(e.target.value)}
              >
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                className="rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-sm font-medium"
                onClick={() => updateLineStatus(selectedLineId, "Healthy")}
              >
                Set Healthy
              </button>
              <button
                className="rounded-md bg-red-600 hover:bg-red-500 px-3 py-2 text-sm font-medium"
                onClick={() => updateLineStatus(selectedLineId, "Fault")}
              >
                Set Fault
              </button>
              <button
                className="rounded-md bg-neutral-700 hover:bg-neutral-600 px-3 py-2 text-sm font-medium"
                onClick={() => updateLineStatus(selectedLineId, "Shutoff")}
              >
                Shutoff
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                className="flex-1 rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-2 text-sm"
                onClick={() => toggleLineVisibility(selectedLineId, true)}
              >
                Show Line
              </button>
              <button
                className="flex-1 rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-2 text-sm"
                onClick={() => toggleLineVisibility(selectedLineId, false)}
              >
                Hide Line
              </button>
            </div>

            <div className="pt-2 border-t border-neutral-800">
              <button
                className="w-full rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-2 text-sm"
                onClick={simulateFault}
              >
                Simulate Random Fault
              </button>
            </div>
          </div>
        </aside>

        {/* Notifications */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <h3 className="text-lg font-bold">Notifications</h3>
            <button
              className="text-xs text-neutral-300 hover:text-neutral-100 underline decoration-neutral-700"
              onClick={() => setNotifications([])}
            >
              Clear All
            </button>
          </div>
          <div className="p-4 space-y-2 max-h-72 overflow-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-neutral-400">No recent events.</p>
            ) : (
              notifications.map((n) => (
                <article
                  key={n.id}
                  className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
                  aria-live="polite"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{lines.find((l) => l.id === n.lineId)?.name || "System"}</p>
                    <time className="text-[10px] text-neutral-500">{formatTime(n.ts)}</time>
                  </div>
                  <p className="text-sm mt-1">
                    <span
                      className={
                        n.status === "Fault"
                          ? "text-red-400"
                          : n.status === "Healthy"
                            ? "text-emerald-400"
                            : "text-neutral-400"
                      }
                    >
                      {n.status}
                    </span>{" "}
                    — {n.message}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>

        {/* Reports */}
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 lg:col-span-2">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <h3 className="text-lg font-bold">Reports</h3>
            <button
              className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm"
              onClick={downloadCSV}
            >
              Download CSV
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <p className="text-xs text-neutral-400">Total Lines</p>
                <p className="text-2xl font-bold mt-1">{report.total}</p>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <p className="text-xs text-neutral-400">Healthy</p>
                <p className="text-2xl font-bold mt-1 text-emerald-400">{report.counts.Healthy}</p>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <p className="text-xs text-neutral-400">Faults</p>
                <p className="text-2xl font-bold mt-1 text-red-400">{report.counts.Fault}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <p className="text-xs text-neutral-400">Shutoff</p>
                <p className="text-2xl font-bold mt-1 text-neutral-300">{report.counts.Shutoff}</p>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
                <p className="text-xs text-neutral-400">Estimated Uptime</p>
                <p className="text-2xl font-bold mt-1 text-neutral-100">{report.uptime}%</p>
              </div>
            </div>

            <p className="text-xs text-neutral-500 mt-4">
              Note: Metrics are illustrative based on current mock statuses.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
