import * as THREE from 'three'
import { project } from './route.js'
import { createVehicle, disposeVehicle } from './vehicles.js'

/**
 * The stylised scene: a dark ground plane, a glowing route ribbon, start and
 * end markers, and a vehicle that drives the path with a chase camera.
 *
 * Routes are normalised to a fixed world span so framing and camera distance
 * behave identically for a 2 km hop and a 2000 km haul.
 */

const BG = 0x09090b
const ACCENT = 0x8ab4ff
const ROUTE_SPAN = 300      // world units the longest axis of any route maps to
const CAM_BACK = 13
const CAM_UP = 5.5

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
    this.scene.fog = new THREE.Fog(BG, 90, 420)

    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 4000)
    this.camera.position.set(0, 40, 60)

    this._addLights()
    this._addGround()

    this.routeGroup = new THREE.Group()
    this.scene.add(this.routeGroup)

    this.vehicle = null
    this.curve = null
    this.progress = 0
    this.vehicleId = 'car'

    this._resize()
  }

  _addLights () {
    this.scene.add(new THREE.HemisphereLight(0x9bb8ff, 0x0a0a0d, 0.75))

    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(60, 120, 40)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const d = 120
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 400 })
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(ACCENT, 0.7)
    rim.position.set(-50, 30, -60)
    this.scene.add(rim)
  }

  _addGround () {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 1, metalness: 0 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    this.scene.add(ground)

    const grid = new THREE.GridHelper(3000, 150, 0x252b36, 0x191d25)
    grid.position.y = 0
    grid.material.transparent = true
    grid.material.opacity = 0.7
    this.scene.add(grid)
  }

  /** Replace the drawn route. Accepts a route object from route.js. */
  setRoute (route) {
    this._clearRoute()

    const { points, span } = project(route.coordinates)
    const k = ROUTE_SPAN / span
    const pts = points.map(p => new THREE.Vector3(p.x * k, 0, p.z * k))

    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25)
    this.curveLength = this.curve.getLength()

    // Route ribbon. Flattened hard on Y so it reads as a line painted on the
    // ground rather than a pipe — a round tube tall enough to see would
    // swallow the vehicle, which drives along the same centreline.
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

    // faint halo so the line reads against the dark ground
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(this.curve, Math.min(300, pts.length * 4), 3.4, 8, false),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.06 })
    )
    halo.scale.y = 0.012
    halo.position.y = 0.03
    this.routeGroup.add(halo)

    this.routeGroup.add(this._marker(pts[0], ACCENT))
    this.routeGroup.add(this._marker(pts[pts.length - 1], 0xffffff))

    this.setVehicle(this.vehicleId)
    this.seek(0)
  }

  _marker (position, color) {
    const g = new THREE.Group()
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 11, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
    )
    pillar.position.y = 5.5
    g.add(pillar)

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.3, 28),
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
      this.scene.remove(this.vehicle)
      disposeVehicle(this.vehicle)
    }
    this.vehicle = createVehicle(id)
    this.scene.add(this.vehicle)
    if (this.curve) this.seek(this.progress)
  }

  /** Place vehicle and camera at t along the route, t in [0,1]. */
  seek (t) {
    if (!this.curve || !this.vehicle) return
    this.progress = THREE.MathUtils.clamp(t, 0, 1)

    const spec = this.vehicle.userData.spec
    const pos = this.curve.getPointAt(this.progress)
    const tangent = this.curve.getTangentAt(this.progress).normalize()

    // planes lift off after take-off and settle before landing
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
      this.vehicle.rotateZ(THREE.MathUtils.clamp(wrapped * 6, -0.45, 0.45))
    }

    const back = tangent.clone().multiplyScalar(-CAM_BACK)
    this.camera.position.set(
      pos.x + back.x,
      pos.y + lift + CAM_UP + (spec.flies ? 6 : 0),
      pos.z + back.z
    )
    this.camera.lookAt(pos.x + tangent.x * 6, pos.y + lift + 1.6, pos.z + tangent.z * 6)
  }

  /** Pull the camera back to frame the whole route, for the idle state. */
  frameAll () {
    if (!this.curve) return
    const box = new THREE.Box3().setFromObject(this.routeGroup)
    const centre = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.z) * 0.62
    this.camera.position.set(centre.x, radius * 0.9 + 40, centre.z + radius * 1.25)
    this.camera.lookAt(centre)
  }

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

  render () { this.renderer.render(this.scene, this.camera) }

  dispose () {
    this._clearRoute()
    if (this.vehicle) disposeVehicle(this.vehicle)
    this.renderer.dispose()
  }
}
