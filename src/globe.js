import * as THREE from 'three'
import { COASTLINES } from './coastline.js'

/**
 * The zoomed-all-the-way-out view: a stylised globe with real coastlines and
 * the journey drawn as an arc on the surface.
 *
 * This is a separate representation rather than a continuation of the local
 * scene, because the two cannot share a scale. A 130 km drive is 0.3% of
 * Earth's circumference — at true scale on a globe it is a speck, and a
 * vehicle sized to be visible beside it would be larger than a continent.
 * So the local scene normalises the route to a fixed span, and the globe
 * shows it at true geographic scale. Zoom crossfades between them.
 */

const R = 100
const ACCENT = 0x8ab4ff
const LAND = 0x3b4756
const OCEAN = 0x0e1218

/** lon/lat (degrees) to a point on a sphere of the given radius. */
export function toSphere (lon, lat, radius = R) {
  const phi = (90 - lat) * Math.PI / 180
  const theta = (lon + 180) * Math.PI / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

export class Globe {
  constructor () {
    this.group = new THREE.Group()
    this.group.visible = false
    this.routeGroup = new THREE.Group()
    this.spin = 0

    this._build()
    this.group.add(this.routeGroup)
  }

  _build () {
    // ocean / body
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshStandardMaterial({ color: OCEAN, roughness: 0.92, metalness: 0.05 })
    )
    this.group.add(body)

    // atmosphere: a slightly larger shell rendered from the inside, so it
    // reads as a rim of light around the edge rather than a fog over the face
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.035, 48, 36),
      new THREE.MeshBasicMaterial({
        color: ACCENT, transparent: true, opacity: 0.075,
        side: THREE.BackSide, depthWrite: false
      })
    )
    this.group.add(atmo)

    this.group.add(this._coastlines())
    this.group.add(this._graticule())
  }

  _coastlines () {
    const verts = []
    for (const flat of COASTLINES) {
      for (let i = 0; i < flat.length - 2; i += 2) {
        const a = toSphere(flat[i], flat[i + 1], R * 1.002)
        const b = toSphere(flat[i + 2], flat[i + 3], R * 1.002)
        verts.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: LAND, transparent: true, opacity: 0.95 })
    )
  }

  _graticule () {
    const verts = []
    const push = (aLon, aLat, bLon, bLat) => {
      const a = toSphere(aLon, aLat, R * 1.0005)
      const b = toSphere(bLon, bLat, R * 1.0005)
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 5) push(lon, lat, lon + 5, lat)
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -85; lat < 85; lat += 5) push(lon, lat, lon, lat + 5)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0x1b2430, transparent: true, opacity: 0.6 })
    )
  }

  /** Draw a journey, given its raw [lon,lat] coordinates. */
  setRoute (coordinates) {
    this.clearRoute()
    if (!coordinates?.length) return

    const pts = coordinates.map(([lon, lat]) => toSphere(lon, lat, R * 1.008))

    // A short drive is a sub-degree scratch on the globe; a visible tube has
    // to be thicker than true width or it vanishes entirely.
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2)
    const line = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(400, pts.length * 4), 0.55, 6, false),
      new THREE.MeshBasicMaterial({ color: ACCENT })
    )
    this.routeGroup.add(line)

    const pin = (p, color) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 14, 12),
        new THREE.MeshBasicMaterial({ color })
      )
      m.position.copy(p)
      return m
    }
    this.routeGroup.add(pin(pts[0], ACCENT))
    this.routeGroup.add(pin(pts[pts.length - 1], 0xffffff))

    // remember where to point the camera
    const mid = coordinates[Math.floor(coordinates.length / 2)]
    this.focus = toSphere(mid[0], mid[1], R).normalize()
  }

  clearRoute () {
    for (const c of [...this.routeGroup.children]) {
      this.routeGroup.remove(c)
      c.geometry?.dispose()
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose())
      else c.material?.dispose()
    }
  }

  /**
   * Place the camera to view the route's hemisphere.
   * `t` is 0..1 from the edge of the local scene to fully pulled back.
   */
  aimCamera (camera, t) {
    const dir = (this.focus ?? new THREE.Vector3(0, 0, 1)).clone()
    const dist = THREE.MathUtils.lerp(R * 2.7, R * 4.3, t)

    // a slow drift so the globe never looks frozen
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spin)
    const eye = dir.clone().applyQuaternion(q).multiplyScalar(dist)
    eye.y += R * 0.35

    camera.position.copy(eye)
    camera.lookAt(0, 0, 0)
  }

  update (dt) { this.spin += dt * 0.045 }

  dispose () {
    this.clearRoute()
    this.group.traverse(o => {
      o.geometry?.dispose()
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
      else o.material?.dispose()
    })
  }
}
