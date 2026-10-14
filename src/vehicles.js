import * as THREE from 'three'

/**
 * Procedural low-poly vehicles.
 *
 * These are built from primitives rather than loaded from GLTF files on
 * purpose: no asset pipeline, no licensing questions, a few KB instead of a
 * few MB, and a consistent stylised look that matches the rest of the scene.
 * Every vehicle faces +Z and sits on y=0 so the animator can treat them
 * identically.
 */

const PAINT = 0x8ab4ff   // brand accent
const DARK = 0x1a1d24
const GLASS = 0x2b3340
const TYRE = 0x0d0f13
const LIGHT = 0xfff3d0

function mat (color, { rough = 0.55, metal = 0.1, emissive = null } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    emissive: emissive ?? 0x000000,
    emissiveIntensity: emissive ? 1 : 0
  })
}

function box (w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}

function wheel (radius, width, x, y, z) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16)
  const m = new THREE.Mesh(g, mat(TYRE, { rough: 0.9 }))
  m.rotation.z = Math.PI / 2
  m.position.set(x, y, z)
  m.castShadow = true
  m.userData.spins = true
  return m
}

/* ---------------------------------------------------------------- car -- */

function buildCar () {
  const g = new THREE.Group()
  const body = mat(PAINT, { rough: 0.35, metal: 0.35 })

  g.add(box(1.8, 0.55, 4.0, body, 0, 0.62, 0))          // lower body
  g.add(box(1.6, 0.5, 2.1, body, 0, 1.1, -0.15))        // cabin
  g.add(box(1.52, 0.36, 1.5, mat(GLASS, { rough: 0.15, metal: 0.6 }), 0, 1.16, -0.1))

  // headlights read as direction of travel at a glance
  g.add(box(0.35, 0.16, 0.1, mat(LIGHT, { emissive: LIGHT }), 0.6, 0.68, 2.0))
  g.add(box(0.35, 0.16, 0.1, mat(LIGHT, { emissive: LIGHT }), -0.6, 0.68, 2.0))

  const r = 0.38
  g.add(wheel(r, 0.26, 0.92, r, 1.3))
  g.add(wheel(r, 0.26, -0.92, r, 1.3))
  g.add(wheel(r, 0.26, 0.92, r, -1.3))
  g.add(wheel(r, 0.26, -0.92, r, -1.3))
  return g
}

/* --------------------------------------------------------------- bike -- */

function buildBike () {
  const g = new THREE.Group()
  const frame = mat(PAINT, { rough: 0.4, metal: 0.4 })

  g.add(box(0.34, 0.3, 1.5, frame, 0, 0.72, 0))         // tank / spine
  g.add(box(0.44, 0.18, 0.6, mat(DARK), 0, 0.92, -0.45)) // seat
  g.add(box(0.5, 0.1, 0.12, mat(DARK), 0, 1.0, 0.52))    // bars

  const rider = new THREE.Group()
  rider.add(box(0.36, 0.56, 0.26, mat(DARK), 0, 1.35, -0.2))
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), mat(0xf0f0f2))
  head.position.set(0, 1.76, -0.2)
  head.name = 'head'          // phase 2 hooks the uploaded face onto this
  rider.add(head)
  g.add(rider)

  g.add(box(0.2, 0.14, 0.1, mat(LIGHT, { emissive: LIGHT }), 0, 0.95, 0.6))

  const r = 0.44
  g.add(wheel(r, 0.14, 0, r, 0.86))
  g.add(wheel(r, 0.14, 0, r, -0.86))
  return g
}

/* ---------------------------------------------------------------- van -- */

function buildVan () {
  const g = new THREE.Group()
  const body = mat(0xf0f2f6, { rough: 0.45 })

  g.add(box(2.0, 1.5, 4.6, body, 0, 1.05, -0.2))
  g.add(box(1.95, 0.85, 1.1, body, 0, 0.92, 2.15))
  g.add(box(1.86, 0.5, 0.1, mat(GLASS, { rough: 0.15, metal: 0.6 }), 0, 1.12, 2.68))
  g.add(box(0.3, 0.16, 0.1, mat(LIGHT, { emissive: LIGHT }), 0.7, 0.6, 2.7))
  g.add(box(0.3, 0.16, 0.1, mat(LIGHT, { emissive: LIGHT }), -0.7, 0.6, 2.7))

  const r = 0.44
  g.add(wheel(r, 0.3, 1.02, r, 1.6))
  g.add(wheel(r, 0.3, -1.02, r, 1.6))
  g.add(wheel(r, 0.3, 1.02, r, -1.5))
  g.add(wheel(r, 0.3, -1.02, r, -1.5))
  return g
}

/* -------------------------------------------------------------- plane -- */

function buildPlane () {
  const g = new THREE.Group()
  const body = mat(0xf4f6fa, { rough: 0.3, metal: 0.3 })

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 3.2, 6, 14), body)
  fuselage.rotation.x = Math.PI / 2
  fuselage.position.y = 1.4
  g.add(fuselage)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 14), body)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 1.4, 2.3)
  g.add(nose)

  g.add(box(5.6, 0.1, 0.9, mat(PAINT, { rough: 0.35, metal: 0.3 }), 0, 1.35, -0.1))
  g.add(box(2.0, 0.08, 0.5, mat(PAINT, { rough: 0.35, metal: 0.3 }), 0, 1.55, -1.85))
  g.add(box(0.08, 0.8, 0.6, body, 0, 1.85, -1.85))

  g.add(box(0.22, 0.12, 0.1, mat(LIGHT, { emissive: LIGHT }), 2.7, 1.35, 0.2))
  g.add(box(0.22, 0.12, 0.1, mat(LIGHT, { emissive: LIGHT }), -2.7, 1.35, 0.2))
  return g
}

/* -------------------------------------------------------------- train -- */

function buildTrain () {
  const g = new THREE.Group()
  const body = mat(PAINT, { rough: 0.35, metal: 0.4 })

  g.add(box(2.0, 1.5, 5.4, body, 0, 1.15, 0))
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.0, 16, 1, false, 0, Math.PI), body)
  snout.rotation.set(Math.PI / 2, 0, Math.PI / 2)
  snout.position.set(0, 1.15, 2.7)
  snout.scale.set(1, 1, 1.4)
  g.add(snout)

  g.add(box(1.84, 0.55, 0.12, mat(GLASS, { rough: 0.12, metal: 0.65 }), 0, 1.5, 3.35))
  g.add(box(0.26, 0.14, 0.1, mat(LIGHT, { emissive: LIGHT }), 0.6, 0.72, 3.4))
  g.add(box(0.26, 0.14, 0.1, mat(LIGHT, { emissive: LIGHT }), -0.6, 0.72, 3.4))
  g.add(box(2.1, 0.22, 5.6, mat(DARK), 0, 0.3, 0))

  const r = 0.3
  for (const z of [1.9, 0.6, -0.9, -2.1]) {
    g.add(wheel(r, 0.18, 0.95, r, z))
    g.add(wheel(r, 0.18, -0.95, r, z))
  }
  return g
}

/* ----------------------------------------------------------- registry -- */

export const VEHICLES = [
  { id: 'car', label: 'Car', build: buildCar, speed: 1.0, banks: true, flies: false },
  { id: 'bike', label: 'Bike', build: buildBike, speed: 1.15, banks: true, flies: false },
  { id: 'van', label: 'Van', build: buildVan, speed: 0.85, banks: true, flies: false },
  { id: 'train', label: 'Train', build: buildTrain, speed: 1.1, banks: false, flies: false },
  { id: 'plane', label: 'Plane', build: buildPlane, speed: 1.6, banks: true, flies: true }
]

export function createVehicle (id) {
  const spec = VEHICLES.find(v => v.id === id) ?? VEHICLES[0]
  const group = spec.build()
  group.userData.spec = spec
  group.traverse(o => { if (o.isMesh) o.castShadow = true })
  return group
}

/** Dispose geometries/materials so swapping vehicles does not leak GPU memory. */
export function disposeVehicle (group) {
  group.traverse(o => {
    if (!o.isMesh) return
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
    else o.material?.dispose()
  })
}
