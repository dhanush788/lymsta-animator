/**
 * Route data.
 *
 * Mapbox is used here as a *data* API only — geocoding and directions. The
 * scene is drawn in Three.js, so no map tiles are ever requested and no map
 * loads are billed. Without a token the module serves a built-in demo route
 * so the rest of the app stays exercisable.
 */

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || ''
export const hasToken = Boolean(TOKEN)

const GEOCODE = 'https://api.mapbox.com/geocoding/v5/mapbox.places'
const DIRECTIONS = 'https://api.mapbox.com/directions/v5/mapbox'

/** Bengaluru → Mysuru, trimmed. Used when no token is configured. */
const DEMO = {
  start: { name: 'Bengaluru', center: [77.5946, 12.9716] },
  end: { name: 'Mysuru', center: [76.6394, 12.2958] },
  distance: 144000,
  duration: 10800,
  coordinates: [
    [77.5946, 12.9716], [77.5521, 12.9345], [77.5102, 12.9105], [77.4598, 12.8873],
    [77.4021, 12.8502], [77.3444, 12.8098], [77.2866, 12.7641], [77.2290, 12.7205],
    [77.1703, 12.6788], [77.1124, 12.6390], [77.0548, 12.5981], [76.9971, 12.5560],
    [76.9395, 12.5162], [76.8818, 12.4760], [76.8242, 12.4361], [76.7665, 12.3959],
    [76.7089, 12.3560], [76.6730, 12.3180], [76.6394, 12.2958]
  ]
}

export class RouteError extends Error {
  constructor (message, { cause } = {}) {
    super(message)
    this.name = 'RouteError'
    this.cause = cause
  }
}

async function getJSON (url, what) {
  let res
  try {
    res = await fetch(url)
  } catch (cause) {
    throw new RouteError(`Could not reach Mapbox to ${what}. Check your connection.`, { cause })
  }
  if (res.status === 401) throw new RouteError('Mapbox rejected the access token. Check VITE_MAPBOX_TOKEN.')
  if (res.status === 429) throw new RouteError('Mapbox rate limit reached. Wait a moment and try again.')
  if (!res.ok) throw new RouteError(`Mapbox failed to ${what} (HTTP ${res.status}).`)
  return res.json()
}

/** Resolve a typed place name to a coordinate. */
export async function geocode (query) {
  const q = query.trim()
  if (!q) throw new RouteError('Enter a place name.')
  if (!hasToken) throw new RouteError('No Mapbox token configured, so places cannot be looked up.')

  const url = `${GEOCODE}/${encodeURIComponent(q)}.json?access_token=${TOKEN}&limit=1`
  const data = await getJSON(url, 'look up that place')
  const hit = data.features?.[0]
  if (!hit) throw new RouteError(`No place found for "${q}".`)
  return { name: hit.place_name, center: hit.center }
}

/**
 * Fetch a driving route between two coordinates.
 * Falls back to a straight line when Mapbox has no road route (e.g. across
 * an ocean), so a plane journey still animates sensibly.
 */
export async function fetchRoute (start, end, profile = 'driving') {
  if (!hasToken) throw new RouteError('No Mapbox token configured.')

  const pair = `${start.center.join(',')};${end.center.join(',')}`
  const url = `${DIRECTIONS}/${profile}/${pair}?geometries=geojson&overview=full&access_token=${TOKEN}`
  const data = await getJSON(url, 'plan that route')
  const leg = data.routes?.[0]

  if (!leg) {
    return {
      start, end, straight: true,
      distance: haversine(start.center, end.center),
      duration: 0,
      coordinates: interpolate(start.center, end.center, 48)
    }
  }
  return {
    start, end, straight: false,
    distance: leg.distance,
    duration: leg.duration,
    coordinates: leg.geometry.coordinates
  }
}

export function demoRoute () {
  return { ...DEMO, straight: false }
}

/* -------------------------------------------------------------- maths -- */

const R = 6371000

export function haversine ([lon1, lat1], [lon2, lat2]) {
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function interpolate (a, b, steps) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  })
}

/**
 * Project lon/lat to local metres using an equirectangular approximation
 * centred on the route. Accurate enough at journey scale and far cheaper
 * than a full projection, which matters on low-end phones.
 */
export function project (coordinates) {
  const lons = coordinates.map(c => c[0])
  const lats = coordinates.map(c => c[1])
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const cosLat = Math.cos(midLat * Math.PI / 180)

  const points = coordinates.map(([lon, lat]) => ({
    x: (lon - midLon) * (Math.PI / 180) * R * cosLat,
    z: -(lat - midLat) * (Math.PI / 180) * R
  }))

  let span = 0
  for (const p of points) span = Math.max(span, Math.hypot(p.x, p.z))
  return { points, span: span || 1 }
}

export function formatDistance (metres) {
  if (!metres) return '—'
  return metres >= 1000
    ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km`
    : `${Math.round(metres)} m`
}

export function formatDuration (seconds) {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} hr ${m} min` : `${m} min`
}
