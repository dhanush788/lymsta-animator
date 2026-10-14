import { JourneyScene } from './scene.js'
import { VEHICLES } from './vehicles.js'
import {
  hasToken, geocode, fetchRoute, demoRoute, RouteError,
  formatDistance, formatDuration
} from './route.js'
import { Recorder, recordingSupport, downloadBlob, safeName } from './recorder.js'

const $ = id => document.getElementById(id)

const els = {
  demoNote: $('demo-note'),
  form: $('route-form'),
  start: $('start'),
  end: $('end'),
  plan: $('plan'),
  vehicles: $('vehicles'),
  length: $('length'),
  lengthVal: $('length-val'),
  distance: $('stat-distance'),
  duration: $('stat-duration'),
  play: $('play'),
  record: $('record'),
  status: $('status'),
  canvas: $('stage'),
  scrub: $('scrub'),
  recBadge: $('rec-badge')
}

const scene = new JourneyScene(els.canvas)
const recorder = new Recorder(els.canvas)

const state = {
  route: null,
  playing: false,
  recording: false,
  busy: false,
  startedAt: 0,
  clipMs: 12000
}

/* ------------------------------------------------------------ helpers -- */

function say (message, kind = '') {
  els.status.textContent = message
  if (kind) els.status.dataset.kind = kind
  else delete els.status.dataset.kind
}

function setBusy (busy) {
  state.busy = busy
  els.plan.disabled = busy
  els.play.disabled = busy || !state.route
  els.record.disabled = busy || !state.route
}

/* ----------------------------------------------------------- vehicles -- */

VEHICLES.forEach((v, i) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'chip'
  b.textContent = v.label
  b.setAttribute('aria-pressed', String(i === 0))
  b.addEventListener('click', () => {
    for (const other of els.vehicles.children) other.setAttribute('aria-pressed', 'false')
    b.setAttribute('aria-pressed', 'true')
    scene.setVehicle(v.id)
  })
  els.vehicles.appendChild(b)
})

/* -------------------------------------------------------------- route -- */

function applyRoute (route) {
  state.route = route
  scene.setRoute(route)
  // Open on the chase camera at the start line. Framing the whole route
  // renders a near-empty screen, because a 4-unit vehicle on a 300-unit
  // route is invisible from that distance.
  scene.seek(0)
  els.distance.textContent = formatDistance(route.distance)
  els.duration.textContent = formatDuration(route.duration)
  els.scrub.value = '0'
  setBusy(false)
}

els.form.addEventListener('submit', async e => {
  e.preventDefault()
  if (!hasToken) {
    say('Place search needs a Mapbox token. Showing the sample route instead.', 'error')
    return
  }
  const from = els.start.value.trim()
  const to = els.end.value.trim()
  if (!from || !to) return say('Enter both a start and an end place.', 'error')

  setBusy(true)
  say('Looking up places…')
  try {
    const [a, b] = await Promise.all([geocode(from), geocode(to)])
    say('Planning the route…')
    const route = await fetchRoute(a, b)
    applyRoute(route)
    say(route.straight
      ? 'No road route exists between those, so this is a direct line.'
      : `${a.name.split(',')[0]} to ${b.name.split(',')[0]}.`, 'ok')
  } catch (err) {
    setBusy(false)
    say(err instanceof RouteError ? err.message : 'Something went wrong planning that route.', 'error')
    if (!(err instanceof RouteError)) console.error(err)
  }
})

/* --------------------------------------------------------- transport -- */

els.length.addEventListener('input', () => {
  state.clipMs = Number(els.length.value) * 1000
  els.lengthVal.textContent = `${els.length.value}s`
})

els.scrub.addEventListener('input', () => {
  if (state.playing) stopPlayback()
  scene.seek(Number(els.scrub.value) / 1000)
})

function startPlayback () {
  if (!state.route) return
  state.playing = true
  state.startedAt = performance.now()
  els.play.textContent = 'Stop'
  scene.seek(0)
}

function stopPlayback () {
  state.playing = false
  els.play.textContent = 'Play'
}

els.play.addEventListener('click', () => {
  state.playing ? stopPlayback() : startPlayback()
})

/* ----------------------------------------------------------- record -- */

els.record.addEventListener('click', async () => {
  if (state.recording) return
  if (!state.route) return say('Plan a route first.', 'error')

  const support = recordingSupport()
  if (!support.supported) return say(support.reason, 'error')

  try {
    recorder.start()
  } catch (err) {
    return say(err.message, 'error')
  }

  state.recording = true
  els.recBadge.hidden = false
  setBusy(true)
  say(`Recording ${els.length.value}s…`)
  startPlayback()
})

async function finishRecording () {
  state.recording = false
  els.recBadge.hidden = true
  try {
    const { blob, ext } = await recorder.stop()
    const name = `${safeName(state.route.start?.name, state.route.end?.name)}.${ext}`
    downloadBlob(blob, name)
    say(`Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB).`, 'ok')
  } catch (err) {
    say(err.message || 'The recording failed.', 'error')
  } finally {
    setBusy(false)
  }
}

/* ------------------------------------------------------------- loop -- */

function tick (now) {
  if (state.playing) {
    const t = (now - state.startedAt) / state.clipMs
    if (t >= 1) {
      scene.seek(1)
      els.scrub.value = '1000'
      stopPlayback()
      if (state.recording) finishRecording()
    } else {
      scene.seek(t)
      els.scrub.value = String(Math.round(t * 1000))
    }
  }
  scene.render()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/* ------------------------------------------------------------ resize -- */

const ro = new ResizeObserver(() => scene.resize())
ro.observe(els.canvas)
window.addEventListener('resize', () => scene.resize())

/* -------------------------------------------------------------- boot -- */

if (!hasToken) {
  els.demoNote.hidden = false
  els.start.disabled = true
  els.end.disabled = true
  els.plan.disabled = true
  els.start.placeholder = 'Needs a Mapbox token'
  els.end.placeholder = 'Needs a Mapbox token'
  applyRoute(demoRoute())
  say('Demo route loaded. Press Play.')
} else {
  applyRoute(demoRoute())
  say('Sample route loaded. Search two places to plan your own.')
}
