# Lymsta Journey

Enter two places, watch a vehicle animate the journey in 3D, download the clip.
The first Lymsta product.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run preview    # serve the build
```

## Mapbox token

Place search and routing need a free Mapbox **public** token (`pk.…`) from
https://account.mapbox.com/access-tokens/

```bash
cp .env.example .env
# then set VITE_MAPBOX_TOKEN=pk.your_token
```

Without a token the app runs in **demo mode**: the inputs are disabled and a
built-in Bengaluru → Mysuru route is loaded, so the animation and download
still work.

Note the token is compiled into the client bundle — that is normal for a
public token, but restrict it by URL in the Mapbox dashboard before deploying.

## How it works

Mapbox is used as a **data API only** — geocoding and directions. The scene is
drawn in Three.js, so no map tiles are ever requested and no map loads are
billed. Only API calls count against the free tier.

| File | Role |
|---|---|
| `src/route.js` | Geocoding, directions, lon/lat → local metres, demo route |
| `src/scene.js` | Three.js scene, route ribbon, chase camera |
| `src/vehicles.js` | Procedural low-poly vehicles (no GLTF assets) |
| `src/recorder.js` | Canvas capture via MediaRecorder |
| `src/main.js` | UI wiring and the animation loop |

Vehicles are built from primitives rather than loaded as GLTF: no asset
pipeline, no model licensing, a few KB instead of a few MB.

## Download format

`MediaRecorder` decides the container. Chrome and Firefox produce WebM; recent
Safari can produce MP4. The app picks the best the browser reports and names
the file accordingly. True cross-browser MP4 would need `ffmpeg.wasm` or a
server-side encode — neither is wired up.

## Not built yet

- **Face insertion.** The bike rider's head mesh is named `head` as the
  attachment point. Planned as client-side only: the photo never leaves the
  browser, which keeps it out of biometric-data territory entirely.
- Real place autocomplete (currently a single geocode on submit).
- Walking/cycling routing profiles — the API call supports them, no UI yet.
