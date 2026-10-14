import * as THREE from 'three'
import { project } from './route.js'
import { createVehicle, disposeVehicle } from './vehicles.js'
import { Globe } from './globe.js'

/**
 * Two views of the same journey, selected by one zoom control.
 *
 * Local view: a dark ground plane, a glowing route ribbon, and the vehicle
 * driving it. The route is normalised to a fixed world span so framing works
 * the same for a 2 km hop and a 2000 km haul.
 *
 * Globe view: the route at true geographic scale on a sphere with real
 * coastlines. See globe.js for why these cannot share one continuous scale.
 *
 * Zoom 0 → tight chase camera. Zoom ~0.8 → the whole route from above.
 * Past that it hands over to the globe.
 */

const BG = 0x09090b
const ACCENT = 0x8ab4ff
const ROUTE_SPAN = 300
const FOG_NEAR = 90
const FOG_FAR = 1600

const GLOBE_FROM = 0.82   // zoom at which the globe takes over
const CHASE_BACK = 13
const CHASE_UP = 5.5

export class JourneyScene {
  constructor (canvas) {
    this.canvas = canvas

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true   // required for frame capture
    })
    this.renderer.setClearColor(BG, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(BG)
    this.fog = new THREE.Fog(BG, FOG_NEAR, FOG_FAR)
    this.scene.fog = this.fog

    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 6000)

    this.local = new THREE.Group()
    this.scene.add(this.local)

    this._addLights()
    this._addGround()

    this.routeGroup = new THREE.Group()
    this.local.add(this.routeGroup)

    this.globe = new Globe()
    this.scene.add(this.globe.group)

    this.vehicle = null
    this.curve = null
    this.progress = 0
    this.zoom = 0.22
    this.vehicleId = 'car'
    this.routeRadius = 150
    this.routeCentre = new THREE.Vector3()
    this.globeForced = false
    this._lastFrame = performance.now()

    this._resize()
  }

  _addLights () {
    this.scene.add(new THREE.HemisphereLight(0x9bb8ff, 0x0a0a0d, 0.8))

    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(60, 120, 40)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const d = 160
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 500 })
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(ACCENT, 0.75)
    rim.position.set(-50, 30, -60)
    this.scene.add(rim)
  }

  _addGround () {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 1, metalness: 0 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    this.local.add(ground)

    const grid = new THREE.GridHelper(4000, 200, 0x252b36, 0x191d25)
    grid.material.transparent = true
    grid.material.opacity = 0.7
    this.local.add(grid)
  }

  /** Replace the drawn route. Accepts a route object from route.js. */
  setRoute (route) {
    this._clearRoute()
    this.coordinates = route.coordinates

    const { points, span } = project(route.coordinates)
    const k = ROUTE_SPAN / span
    const pts = points.map(p => new THREE.Vector3(p.x * k, 0, p.z * k))

    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25)

    const box = new THREE.Box3().setFromPoints(pts)
    box.getCenter(this.routeCentre)
    const size = box.getSize(new THREE.Vector3())
    this.routeRadius = Math.max(size.x, size.z, 40) * 0.6

    // Route ribbon, flattened hard on Y so it reads as a line painted on the
    // ground. A round tube tall enough to see would swallow the vehicle,
    // which drives along the same centreline.
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, Math.min(600, pts.length * 8), 1.15, 8, false),
      new THREE.MeshStandardMaterial({
        color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.38,
        roughness: 0.4, metalness: 0.1
      })
    )
    tube.scale.y = 0.045
    tube.position.y = 0.06
    this.routeGroup.add(tube)

    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, Math.min(300, pts.length * 4), 3.4, 8, false),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.06 })
    )
    halo.scale.y = 0.012
    halo.position.y = 0.03
    this.routeGroup.add(halo)

    this.routeGroup.add(this._marker(pts[0], ACCENT))
    this.routeGroup.add(this._marker(pts[pts.length - 1], 0xffffff))

    this.globe.setRoute(route.coordinates)

    this.setVehicle(this.vehicleId)
    this.seek(0.015)
  }

  _marker (position, color) {
    const g = new THREE.Group()
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 6.5, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
    )
    pillar.position.y = 3.25
    g.add(pillar)

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 2.9, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06
    g.add(ring)

    g.position.copy(position)
    return g
  }

  setVehicle (id) {
    this.vehicleId = id
    if (this.vehicle) {
      this.local.remove(this.vehicle)
      disposeVehicle(this.vehicle)
    }
    this.vehicle = createVehicle(id)
    this.local.add(this.vehicle)
    if (this.curve) this.seek(this.progress)
  }

  /** Camera zoom, 0 (chase) to 1 (globe). */
  setZoom (z) {
    this.zoom = THREE.MathUtils.clamp(z, 0, 1)
    this.seek(this.progress)
  }

  /** Force the globe on regardless of zoom (the Globe toggle). */
  setGlobeMode (on) {
    this.globeForced = Boolean(on)
    this.seek(this.progress)
  }

  /** How far into globe territory we are, 0..1. */
  get globeBlend () {
    if (this.globeForced) return 1
    return THREE.MathUtils.smoothstep(this.zoom, GLOBE_FROM, 1)
  }

  _aimGlobe () {
    const t = GLOBE_FROM < 1 ? (this.zoom - GLOBE_FROM) / (1 - GLOBE_FROM) : 1
    this.globe.aimCamera(this.camera, THREE.MathUtils.clamp(t, 0, 1))
  }

  /** Place vehicle and camera at t along the route, t in [0,1]. */
  seek (t) {
    if (!this.curve || !this.vehicle) return
    this.progress = THREE.MathUtils.clamp(t, 0, 1)

    const spec = this.vehicle.userData.spec
    const pos = this.curve.getPointAt(this.progress)
    const tangent = this.curve.getTangentAt(this.progress).normalize()

    let lift = 0
    if (spec.flies) {
      const climb = THREE.MathUtils.smoothstep(this.progress, 0, 0.12)
      const descend = 1 - THREE.MathUtils.smoothstep(this.progress, 0.88, 1)
      lift = 26 * Math.min(climb, descend)
    }

    this.vehicle.position.set(pos.x, pos.y + lift, pos.z)
    this.vehicle.lookAt(pos.x + tangent.x, pos.y + lift + tangent.y, pos.z + tangent.z)

    if (spec.banks) {
      const ahead = this.curve.getTangentAt(Math.min(1, this.progress + 0.004))
      const turn = Math.atan2(ahead.x, ahead.z) - Math.atan2(tangent.x, tangent.z)
      const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn))
      this.vehicle.rotateZ(THREE.MathUtils.clamp(wrapped * 2.2, -0.16, 0.16))
    }

    const blend = this.globeBlend
    const onGlobe = blend > 0.001

    this.globe.group.visible = onGlobe
    this.local.visible = blend < 0.999
    this.scene.fog = onGlobe ? null : this.fog

    if (blend >= 0.999) return this._aimGlobe()

    // Local camera: ease from a tight chase to a high wide shot. Past the
    // midpoint the look target drifts from the vehicle toward the route
    // centre, so pulling back frames the journey rather than empty ground.
    // Interpolate GEOMETRICALLY, not linearly. The far end is ~30x the near
    // end, so a linear ramp spends almost its whole travel far away — at 25%
    // the camera would already sit 70 units back, which is not a chase shot.
    // Exponential matches how zoom actually feels, and is what map cameras use.
    const e = this.zoom * this.zoom * (3 - 2 * this.zoom)
    const dist = CHASE_BACK * Math.pow((this.routeRadius * 2.1) / CHASE_BACK, e)
    const high = CHASE_UP * Math.pow((this.routeRadius * 1.5) / CHASE_UP, e)
    const toCentre = THREE.MathUtils.smoothstep(this.zoom, 0.45, 0.95)

    const anchor = new THREE.Vector3(pos.x, pos.y + lift, pos.z)
      .lerp(this.routeCentre, toCentre)

    const back = tangent.clone().multiplyScalar(-dist)
    this.camera.position.set(
      anchor.x + back.x,
      anchor.y + high + (spec.flies ? 6 * (1 - e) : 0),
      anchor.z + back.z
    )

    const lookAhead = 6 * (1 - toCentre)
    this.camera.lookAt(
      anchor.x + tangent.x * lookAhead,
      anchor.y + 1.6 * (1 - e),
      anchor.z + tangent.z * lookAhead
    )
  }

  /** Pull back to frame the whole route. */
  frameAll () { this.setZoom(0.78) }

  _clearRoute () {
    for (const child of [...this.routeGroup.children]) {
      this.routeGroup.remove(child)
      child.traverse?.(o => {
        o.geometry?.dispose()
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
        else o.material?.dispose()
      })
    }
  }

  _resize () {
    const w = this.canvas.clientWidth || 1280
    const h = this.canvas.clientHeight || 720
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  resize () { this._resize() }

  render () {
    const now = performance.now()
    const dt = Math.min((now - this._lastFrame) / 1000, 0.1)
    this._lastFrame = now

    if (this.globe.group.visible) {
      this.globe.update(dt)
      if (this.globeBlend >= 0.999) this._aimGlobe()
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose () {
    this._clearRoute()
    this.globe.dispose()
    if (this.vehicle) disposeVehicle(this.vehicle)
    this.renderer.dispose()
  }
}
