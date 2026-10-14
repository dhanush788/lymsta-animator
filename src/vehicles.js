import * as THREE from 'three'

/**
 * Procedural low-poly vehicles.
 *
 * These are built from code rather than loaded from GLTF files on purpose: no
 * asset pipeline, no licensing questions, a few KB instead of a few MB, and a
 * consistent stylised look that matches the rest of the scene.
 *
 * Shapes come from three techniques rather than stacked boxes:
 *
 *   loft()      - sweeps a 2D cross-section along +Z, interpolating width and
 *                 height per station. This is what gives the car its tapered
 *                 nose, the van its raked screen and the train its snout.
 *   planform()  - extrudes a flat outline (a wing, a tail fin) with a bevelled
 *                 edge, so aerofoils read as swept rather than slab-like.
 *   limb()      - a capsule between two points, for forks, struts, rider arms.
 *
 * Geometry is deliberately non-indexed so computeVertexNormals() produces flat
 * per-face normals: the faceted, hand-made look we want.
 *
 * Every vehicle faces +Z and sits on y=0 so the animator can treat them
 * identically.
 */

/* --------------------------------------------------------------- palette -- */

const PAINT = 0x8ab4ff   // brand accent
const SHELL = 0xeef1f7   // off-white bodywork (van, plane)
const DARK = 0x191c23
const TRIM = 0x343a46
const GLASS = 0x222a38
const TYRE = 0x0c0e12
const RIM = 0x737c8c
const CHROME = 0x9aa3b2
const LIGHT = 0xfff1cc
const TAIL = 0xff5c4d

function mat (color, { rough = 0.55, metal = 0.1, emissive = null, intensity = 1, side } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    emissive: emissive ?? 0x000000,
    emissiveIntensity: emissive ? intensity : 0,
    side: side ?? THREE.FrontSide
  })
}

/** One shared set of materials per vehicle instance. */
function palette (bodyColor) {
  return {
    body: mat(bodyColor, { rough: 0.38, metal: 0.3 }),
    dark: mat(DARK, { rough: 0.7 }),
    trim: mat(TRIM, { rough: 0.6, metal: 0.25 }),
    glass: mat(GLASS, { rough: 0.12, metal: 0.75 }),
    tyre: mat(TYRE, { rough: 0.92 }),
    rim: mat(RIM, { rough: 0.3, metal: 0.8 }),
    chrome: mat(CHROME, { rough: 0.25, metal: 0.9 }),
    lamp: mat(LIGHT, { emissive: LIGHT, intensity: 1.1, rough: 0.3 }),
    tail: mat(TAIL, { emissive: TAIL, intensity: 0.9, rough: 0.35 })
  }
}

/* ------------------------------------------------------------- primitives -- */

function mesh (geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = false
  return m
}

function box (w, h, d, material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z)
}

/**
 * A rounded-rectangle cross-section in the XY plane, wound counter-clockwise.
 * `halfW` is the width at the shoulder, `halfTop` the width at the roof — the
 * difference is what gives bodies their tumblehome instead of slab sides.
 * Always 10 points so stations can be lofted together.
 */
function profile (halfW, halfTop, y0, y1, chamfer = 0.09, shoulder = 0.55) {
  const c = Math.min(chamfer, halfW * 0.45, halfTop * 0.45, (y1 - y0) * 0.35)
  const ys = y0 + (y1 - y0) * shoulder
  return [
    [halfW - c, y0], [halfW, y0 + c], [halfW, ys],
    [halfTop, y1 - c], [halfTop - c, y1],
    [-halfTop + c, y1], [-halfTop, y1 - c],
    [-halfW, ys], [-halfW, y0 + c], [-halfW + c, y0]
  ]
}

/** An elliptical cross-section, same point count as profile(). */
function ring (rx, ry, cy, n = 10) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n
    pts.push([Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}

/**
 * Skin a list of `{ z, pts }` stations (ordered by increasing z) into a closed
 * faceted hull. Both ends are capped with a fan.
 */
function loft (stations) {
  const n = stations[0].pts.length
  const pos = []
  const vert = p => pos.push(p[0], p[1], p[2])
  const tri = (a, b, c) => { vert(a); vert(b); vert(c) }

  for (let s = 0; s < stations.length - 1; s++) {
    const A = stations[s]
    const B = stations[s + 1]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ai = [A.pts[i][0], A.pts[i][1], A.z]
      const aj = [A.pts[j][0], A.pts[j][1], A.z]
      const bj = [B.pts[j][0], B.pts[j][1], B.z]
      const bi = [B.pts[i][0], B.pts[i][1], B.z]
      tri(ai, aj, bj)
      tri(ai, bj, bi)
    }
  }

  const cap = (st, front) => {
    let cx = 0
    let cy = 0
    for (const p of st.pts) { cx += p[0]; cy += p[1] }
    const centre = [cx / n, cy / n, st.z]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const p = [st.pts[i][0], st.pts[i][1], st.z]
      const q = [st.pts[j][0], st.pts[j][1], st.z]
      if (front) tri(centre, p, q)
      else tri(centre, q, p)
    }
  }
  cap(stations[stations.length - 1], true)
  cap(stations[0], false)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/**
 * A flat bevelled outline: `pts` are `[span, chord]` pairs. Span runs along +X,
 * chord along +Z (leading edge towards +Z), thickness along Y centred on zero.
 */
function planform (pts, thickness, bevel = 0.025) {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], -pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1])
  shape.closePath()

  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 1
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -thickness / 2, 0)
  g.computeVertexNormals()
  return g
}

/** A tapered capsule spanning two points — forks, struts, limbs, pantographs. */
function limb (a, b, radius, material, taper = 0.85, seg = 6) {
  const from = new THREE.Vector3(...a)
  const to = new THREE.Vector3(...b)
  const dir = new THREE.Vector3().subVectors(to, from)
  const len = dir.length()
  const m = mesh(new THREE.CylinderGeometry(radius * taper, radius, len, seg), material)
  m.position.copy(from).add(to).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return m
}

/** Tyre + rim (+ optional brake disc), already rotated to roll along Z. */
function wheel (p, radius, width, x, y, z, { rim = 0.6, disc = 0 } = {}) {
  const g = new THREE.Group()
  const tyre = mesh(new THREE.CylinderGeometry(radius, radius, width, 16), p.tyre)
  tyre.rotation.z = Math.PI / 2
  g.add(tyre)
  if (rim) {
    const hub = mesh(new THREE.CylinderGeometry(radius * rim, radius * rim, width * 1.08, 12), p.rim)
    hub.rotation.z = Math.PI / 2
    g.add(hub)
  }
  if (disc) {
    const d = mesh(new THREE.CylinderGeometry(radius * disc, radius * disc, width * 0.22, 12), p.trim,
      width * 0.75, 0, 0)
    d.rotation.z = Math.PI / 2
    g.add(d)
  }
  g.position.set(x, y, z)
  g.userData.spins = true
  return g
}

/**
 * A flared arch sitting over a wheel: a torus segment squashed against the
 * body. `start` rotates the segment within its own plane — 0 is the rear of
 * the wheel, PI/2 the crown, PI the front — so a car arch (start 0, arc PI)
 * and a bike mudguard (crown to front only) come from the same primitive.
 */
function arch (p, radius, tube, x, y, z, { material, arc = Math.PI, start = 0, flat = 0.42 } = {}) {
  const geo = new THREE.TorusGeometry(radius, tube, 4, 8, arc)
  if (start) geo.rotateZ(start)
  const m = mesh(geo, material ?? p.body, x, y, z)
  m.rotation.y = Math.PI / 2
  m.scale.z = flat
  return m
}

/** Mirror a mesh across X without rebuilding its geometry. */
function mirrored (m) {
  const c = m.clone()
  c.position.x *= -1
  c.rotation.y *= -1
  c.rotation.z *= -1
  c.scale.x *= -1
  return c
}

/** Add a mesh and its mirror image. */
function pair (group, m) {
  group.add(m)
  group.add(mirrored(m))
}

/* ---------------------------------------------------------------- car -- */

function buildCar () {
  const g = new THREE.Group()
  const p = palette(PAINT)

  // Hull: nine stations give a tapered nose, flared haunches and a clipped tail.
  const hull = loft([
    { z: -2.04, pts: profile(0.62, 0.58, 0.44, 0.90, 0.10) },
    { z: -1.84, pts: profile(0.76, 0.73, 0.34, 0.95, 0.10) },
    { z: -1.30, pts: profile(0.84, 0.82, 0.28, 0.97, 0.10) },
    { z: -0.40, pts: profile(0.85, 0.83, 0.26, 0.98, 0.10) },
    { z: 0.40, pts: profile(0.85, 0.83, 0.26, 0.98, 0.10) },
    { z: 1.30, pts: profile(0.83, 0.80, 0.28, 0.96, 0.10) },
    { z: 1.76, pts: profile(0.77, 0.70, 0.32, 0.90, 0.10) },
    { z: 1.98, pts: profile(0.66, 0.56, 0.40, 0.80, 0.09) },
    { z: 2.06, pts: profile(0.48, 0.40, 0.48, 0.70, 0.07) }
  ])
  g.add(mesh(hull, p.body))

  // Greenhouse: lofted glass with a raked screen front and back, narrower than
  // the hull so the shoulder line stays visible from the chase camera.
  const cabin = loft([
    { z: -1.50, pts: profile(0.58, 0.50, 0.90, 1.00, 0.06) },
    { z: -1.20, pts: profile(0.72, 0.63, 0.90, 1.26, 0.07) },
    { z: -0.90, pts: profile(0.76, 0.67, 0.90, 1.44, 0.07) },
    { z: -0.10, pts: profile(0.77, 0.69, 0.90, 1.48, 0.07) },
    { z: 0.36, pts: profile(0.76, 0.67, 0.90, 1.45, 0.07) },
    { z: 0.70, pts: profile(0.72, 0.63, 0.90, 1.25, 0.07) },
    { z: 1.00, pts: profile(0.64, 0.56, 0.90, 0.99, 0.06) }
  ])
  g.add(mesh(cabin, p.glass))

  // Painted roof cap over the glass, so the cabin does not read as a bubble.
  g.add(mesh(loft([
    { z: -1.04, pts: profile(0.70, 0.65, 1.34, 1.45, 0.06) },
    { z: -0.10, pts: profile(0.73, 0.69, 1.38, 1.50, 0.06) },
    { z: 0.40, pts: profile(0.71, 0.66, 1.36, 1.47, 0.06) }
  ]), p.body))

  // A- and C-pillars, angled to match the screen rake.
  const aPillar = box(0.08, 0.84, 0.08, p.body, 0.70, 1.21, 0.68)
  aPillar.rotation.x = -0.905
  pair(g, aPillar)
  const cPillar = box(0.08, 0.76, 0.08, p.body, 0.70, 1.20, -1.18)
  cPillar.rotation.x = 0.843
  pair(g, cPillar)

  // Shoulder crease and rocker, to stop the flanks reading flat.
  pair(g, box(0.04, 0.05, 2.5, p.trim, 0.855, 0.84, -0.1))
  pair(g, box(0.07, 0.13, 2.4, p.dark, 0.845, 0.33, -0.15))

  // Nose: grille, splitter, lamps set into the taper.
  g.add(box(0.98, 0.20, 0.10, p.dark, 0, 0.64, 2.04))
  g.add(box(0.72, 0.09, 0.06, p.chrome, 0, 0.64, 2.09))
  g.add(box(1.28, 0.16, 0.14, p.dark, 0, 0.45, 1.99))
  const lamp = box(0.26, 0.10, 0.09, p.lamp, 0.42, 0.77, 1.97)
  lamp.rotation.y = -0.26
  pair(g, lamp)
  const lampTrim = box(0.34, 0.16, 0.08, p.dark, 0.42, 0.77, 1.95)
  lampTrim.rotation.y = -0.26
  pair(g, lampTrim)

  // Tail: lamp bar plus a dark valance.
  pair(g, box(0.26, 0.10, 0.08, p.tail, 0.40, 0.76, -2.06))
  g.add(box(0.92, 0.05, 0.06, p.tail, 0, 0.76, -2.07))
  g.add(box(1.00, 0.16, 0.12, p.dark, 0, 0.52, -2.02))

  // Wing mirrors.
  pair(g, box(0.12, 0.05, 0.05, p.dark, 0.82, 1.00, 0.80))
  const mirror = box(0.16, 0.12, 0.07, p.body, 0.92, 1.02, 0.82)
  mirror.rotation.y = -0.2
  pair(g, mirror)

  // Wheels and arches.
  const r = 0.40
  for (const z of [1.30, -1.30]) {
    g.add(wheel(p, r, 0.26, 0.80, r, z))
    g.add(wheel(p, r, 0.26, -0.80, r, z))
    pair(g, arch(p, r + 0.11, 0.09, 0.85, r, z))
  }
  return g
}


/* --------------------------------------------------------------- bike -- */

function buildBike () {
  const g = new THREE.Group()
  const p = palette(PAINT)
  const suit = mat(0x262b35, { rough: 0.68 })
  const skin = mat(0xf2f3f6, { rough: 0.5 })
  g.userData.extraMaterials = [suit, skin]

  const R = 0.42
  const frontZ = 0.84
  const rearZ = -0.82

  // Teardrop tank, lofted so the bike has a spine rather than a brick.
  g.add(mesh(loft([
    { z: -0.24, pts: profile(0.10, 0.07, 0.74, 0.94, 0.04) },
    { z: 0.00, pts: profile(0.17, 0.13, 0.72, 1.02, 0.05) },
    { z: 0.26, pts: profile(0.18, 0.13, 0.72, 1.00, 0.05) },
    { z: 0.50, pts: profile(0.12, 0.08, 0.76, 0.90, 0.04) }
  ]), p.body))

  // Upswept tail unit with a seat pad and lamp.
  g.add(mesh(loft([
    { z: -0.98, pts: profile(0.10, 0.07, 0.94, 1.06, 0.04) },
    { z: -0.74, pts: profile(0.15, 0.11, 0.90, 1.00, 0.05) },
    { z: -0.30, pts: profile(0.18, 0.14, 0.86, 0.96, 0.05) }
  ]), p.body))
  g.add(box(0.30, 0.09, 0.56, p.dark, 0, 0.99, -0.54))
  g.add(box(0.16, 0.05, 0.05, p.tail, 0, 1.05, -1.00))

  // Engine block, headers, swingarm, trellis spine.
  g.add(box(0.32, 0.36, 0.44, p.trim, 0, 0.60, 0.02))
  g.add(box(0.42, 0.16, 0.30, p.dark, 0, 0.72, 0.00))
  g.add(box(0.26, 0.10, 0.10, p.trim, 0, 0.40, 0.14))
  pair(g, limb([0.13, 0.50, 0.14], [0.17, 0.44, -0.88], 0.05, p.chrome, 1))    // exhaust
  pair(g, limb([0.12, 0.56, -0.12], [0.11, R, rearZ], 0.038, p.trim, 1))       // swingarm
  pair(g, limb([0.10, 0.90, 0.36], [0.12, 0.62, -0.08], 0.038, p.trim, 1))     // frame rail
  pair(g, limb([0.12, 0.62, -0.08], [0.11, 0.96, -0.30], 0.032, p.trim, 1))    // subframe

  // Raked forks, yoke, and a mudguard that hugs the crown of the wheel.
  pair(g, limb([0.12, R, frontZ], [0.12, 1.12, 0.58], 0.042, p.chrome, 1))
  g.add(box(0.28, 0.09, 0.11, p.trim, 0, 1.08, 0.60))
  g.add(arch(p, 0.53, 0.04, 0, R, frontZ, { arc: 1.5, start: 1.05, flat: 0.9 }))
  g.add(arch(p, 0.54, 0.04, 0, R, rearZ, { material: p.dark, arc: 1.1, start: 1.3, flat: 0.9 }))

  // Bars, grips, nose cowl.
  const bar = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 8), p.chrome, 0, 1.14, 0.54)
  bar.rotation.z = Math.PI / 2
  bar.rotation.x = 0.08
  g.add(bar)
  const grip = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 8), p.dark, 0.26, 1.14, 0.54)
  grip.rotation.z = Math.PI / 2
  pair(g, grip)
  g.add(mesh(loft([
    { z: 0.46, pts: profile(0.09, 0.07, 0.92, 1.12, 0.04) },
    { z: 0.62, pts: profile(0.17, 0.13, 0.84, 1.06, 0.05) },
    { z: 0.74, pts: profile(0.13, 0.10, 0.82, 0.98, 0.04) }
  ]), p.body))
  g.add(box(0.22, 0.12, 0.08, p.lamp, 0, 0.90, 0.78))

  // Rider: hips back on the seat, torso raked forward over the tank, arms
  // reaching out and down to the grips, knees tucked into the engine.
  const rider = new THREE.Group()
  const torso = box(0.38, 0.66, 0.28, suit, 0, 1.26, -0.22)
  torso.rotation.x = 0.78
  rider.add(torso)
  rider.add(box(0.44, 0.20, 0.26, suit, 0, 1.44, 0.00))        // shoulders
  rider.add(box(0.30, 0.16, 0.22, p.body, 0, 1.30, -0.16))     // jacket panel

  pair(rider, limb([0.21, 1.44, 0.04], [0.28, 1.24, 0.30], 0.058, suit, 1))   // upper arm
  pair(rider, limb([0.28, 1.24, 0.30], [0.26, 1.14, 0.52], 0.048, suit, 1))   // forearm
  pair(rider, mesh(new THREE.SphereGeometry(0.055, 8, 6), suit, 0.26, 1.14, 0.54))
  pair(rider, limb([0.15, 1.01, -0.40], [0.25, 0.74, 0.06], 0.09, suit, 1))   // thigh
  pair(rider, limb([0.25, 0.74, 0.06], [0.22, 0.48, -0.04], 0.062, suit, 1))  // shin
  pair(rider, box(0.10, 0.07, 0.20, p.dark, 0.22, 0.45, 0.00))               // boot

  const head = mesh(new THREE.SphereGeometry(0.17, 14, 12), skin, 0, 1.63, 0.10)
  head.name = 'head'          // phase 2 hooks the uploaded face onto this
  rider.add(head)
  // Helmet shell wraps the crown and back only, leaving the face clear.
  const helmet = mesh(
    new THREE.SphereGeometry(0.188, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    p.body, head.position.x, head.position.y, head.position.z
  )
  helmet.rotation.x = -0.35
  rider.add(helmet)
  g.add(rider)

  g.add(wheel(p, R, 0.13, 0, R, frontZ))
  g.add(wheel(p, R, 0.17, 0, R, rearZ))
  return g
}

/* ---------------------------------------------------------------- van -- */

function buildVan () {
  const g = new THREE.Group()
  const p = palette(SHELL)

  // Tall body with a hard forward rake into a short bonnet.
  g.add(mesh(loft([
    { z: -2.32, pts: profile(0.90, 0.82, 0.44, 1.98, 0.12, 0.3) },
    { z: -2.10, pts: profile(0.99, 0.90, 0.32, 2.08, 0.12, 0.3) },
    { z: -0.60, pts: profile(1.00, 0.92, 0.30, 2.10, 0.12, 0.3) },
    { z: 0.90, pts: profile(1.00, 0.92, 0.30, 2.10, 0.12, 0.3) },
    { z: 1.48, pts: profile(0.98, 0.88, 0.32, 2.00, 0.12, 0.3) },
    { z: 1.92, pts: profile(0.94, 0.80, 0.34, 1.76, 0.12, 0.3) },
    { z: 2.16, pts: profile(0.86, 0.70, 0.40, 1.42, 0.11, 0.3) },
    { z: 2.32, pts: profile(0.70, 0.58, 0.50, 1.14, 0.09, 0.3) }
  ]), p.body))

  // Raked windscreen sitting on the nose slope, flanked by painted A-pillars.
  const screen = box(1.50, 0.86, 0.07, p.glass, 0, 1.70, 1.90)
  screen.rotation.x = -0.86
  g.add(screen)
  const aPillar = box(0.14, 0.92, 0.10, p.body, 0.80, 1.70, 1.87)
  aPillar.rotation.x = -0.86
  pair(g, aPillar)

  // Cab side glass, B-pillar, accent stripe, body crease, sill.
  pair(g, box(0.05, 0.56, 0.86, p.glass, 1.005, 1.58, 1.08))
  pair(g, box(0.06, 0.60, 0.09, p.dark, 1.008, 1.56, 0.60))
  pair(g, box(0.05, 0.14, 4.3, p.body, 1.010, 1.14, -0.3))
  pair(g, box(0.04, 0.05, 4.3, p.trim, 1.014, 0.98, -0.3))
  pair(g, box(0.07, 0.16, 3.9, p.dark, 0.995, 0.40, -0.3))
  // Sliding-door and rear-door shut lines.
  for (const z of [0.42, -1.1, -2.28]) pair(g, box(0.03, 1.5, 0.05, p.trim, 1.012, 1.16, z))

  // Roof dome vent breaks up the long flat roof.
  g.add(mesh(loft([
    { z: -1.55, pts: profile(0.56, 0.46, 2.02, 2.22, 0.06) },
    { z: -0.70, pts: profile(0.62, 0.52, 2.02, 2.26, 0.06) },
    { z: 0.10, pts: profile(0.54, 0.44, 2.02, 2.18, 0.06) }
  ]), p.trim))

  // Nose furniture.
  g.add(box(1.22, 0.22, 0.10, p.dark, 0, 1.02, 2.30))
  g.add(box(0.90, 0.08, 0.06, p.chrome, 0, 1.02, 2.34))
  g.add(box(1.76, 0.26, 0.16, p.dark, 0, 0.62, 2.22))
  const lamp = box(0.34, 0.16, 0.10, p.lamp, 0.58, 0.95, 2.27)
  lamp.rotation.y = -0.22
  pair(g, lamp)
  pair(g, box(0.16, 0.56, 0.08, p.tail, 0.72, 0.95, -2.34))

  // Big door mirrors on stalks.
  pair(g, box(0.16, 0.05, 0.05, p.dark, 1.08, 1.70, 1.58))
  pair(g, box(0.08, 0.34, 0.14, p.dark, 1.18, 1.62, 1.60))

  const r = 0.44
  for (const z of [1.40, -1.50]) {
    g.add(wheel(p, r, 0.30, 0.90, r, z))
    g.add(wheel(p, r, 0.30, -0.90, r, z))
    pair(g, arch(p, r + 0.13, 0.10, 1.00, r, z))
  }
  return g
}

/* -------------------------------------------------------------- train -- */

function buildTrain () {
  const g = new THREE.Group()
  const p = palette(PAINT)
  const shell = mat(SHELL, { rough: 0.4, metal: 0.25 })
  g.userData.extraMaterials = [shell]

  // Car body: flat sides, slightly domed roof, nose raking down over 1.2 units.
  g.add(mesh(loft([
    { z: -2.92, pts: profile(0.92, 0.84, 0.58, 2.28, 0.14, 0.25) },
    { z: -2.72, pts: profile(1.04, 0.95, 0.50, 2.40, 0.14, 0.25) },
    { z: 0.00, pts: profile(1.05, 0.96, 0.50, 2.42, 0.14, 0.25) },
    { z: 1.70, pts: profile(1.05, 0.96, 0.50, 2.42, 0.14, 0.25) },
    { z: 2.34, pts: profile(1.02, 0.92, 0.52, 2.30, 0.14, 0.25) },
    { z: 2.84, pts: profile(0.94, 0.80, 0.56, 1.96, 0.13, 0.25) },
    { z: 3.18, pts: profile(0.80, 0.62, 0.62, 1.52, 0.12, 0.25) },
    { z: 3.38, pts: profile(0.56, 0.40, 0.74, 1.14, 0.10, 0.25) }
  ]), shell))

  // Continuous window band — the thing that makes it read as an EMU.
  pair(g, box(0.05, 0.62, 5.0, p.glass, 1.055, 1.86, -0.30))
  // Accent stripe below the glass, door shut lines through it.
  pair(g, box(0.05, 0.16, 5.6, p.body, 1.058, 1.40, -0.10))
  for (const z of [2.0, 0.5, -1.0, -2.4]) pair(g, box(0.05, 1.40, 0.07, p.body, 1.062, 1.60, z))

  // Raked cab screen and a painted nose mask.
  const screen = box(1.62, 1.00, 0.08, p.glass, 0, 1.96, 2.70)
  screen.rotation.x = -0.82
  g.add(screen)
  g.add(mesh(loft([
    { z: 3.12, pts: profile(0.80, 0.64, 0.60, 1.30, 0.10) },
    { z: 3.40, pts: profile(0.56, 0.40, 0.72, 1.10, 0.09) }
  ]), p.body))

  // Headlight clusters and a coupler cover.
  pair(g, box(0.26, 0.14, 0.09, p.lamp, 0.46, 1.02, 3.38))
  g.add(box(0.60, 0.26, 0.20, p.dark, 0, 0.74, 3.34))

  // Underframe skirt plus bogies.
  g.add(box(1.92, 0.46, 5.9, p.dark, 0, 0.30, 0.05))
  const r = 0.32
  for (const z of [1.90, -1.96]) {
    g.add(box(1.5, 0.36, 1.5, p.trim, 0, 0.52, z))
    for (const dz of [0.52, -0.52]) {
      g.add(wheel(p, r, 0.16, 0.92, r, z + dz, { rim: 0 }))
      g.add(wheel(p, r, 0.16, -0.92, r, z + dz, { rim: 0 }))
    }
  }

  // Pantograph on the roof — cheap, and instantly reads as electric.
  g.add(box(0.80, 0.07, 0.90, p.dark, 0, 2.46, 0.40))
  pair(g, limb([0.26, 2.50, 0.78], [0.12, 2.96, 0.12], 0.035, p.trim, 1))
  pair(g, limb([0.12, 2.96, 0.12], [0.10, 3.18, 0.66], 0.03, p.trim, 1))
  g.add(box(1.00, 0.05, 0.08, p.chrome, 0, 3.21, 0.68))
  g.add(box(0.90, 0.14, 1.9, p.trim, 0, 2.46, -1.9))      // roof equipment duct
  return g
}

/* -------------------------------------------------------------- plane -- */

function buildPlane () {
  const g = new THREE.Group()
  const p = palette(SHELL)
  const wingMat = mat(SHELL, { rough: 0.32, metal: 0.35, side: THREE.DoubleSide })
  const finMat = mat(PAINT, { rough: 0.35, metal: 0.3, side: THREE.DoubleSide })
  const accent = mat(PAINT, { rough: 0.38, metal: 0.3 })
  g.userData.extraMaterials = [wingMat, finMat, accent]

  const CY = 1.72   // fuselage centreline

  // Fuselage: elliptical stations, pinched nose, upswept tail cone.
  g.add(mesh(loft([
    { z: -2.95, pts: ring(0.09, 0.09, CY + 0.26) },
    { z: -2.52, pts: ring(0.21, 0.23, CY + 0.18) },
    { z: -1.90, pts: ring(0.35, 0.37, CY + 0.08) },
    { z: -0.80, pts: ring(0.46, 0.47, CY) },
    { z: 1.20, pts: ring(0.46, 0.47, CY) },
    { z: 2.02, pts: ring(0.42, 0.43, CY) },
    { z: 2.56, pts: ring(0.30, 0.32, CY + 0.02) },
    { z: 2.88, pts: ring(0.13, 0.14, CY + 0.04) }
  ]), p.body))

  // Swept wing, shared geometry mirrored for the left side.
  const wingGeo = planform([
    [0.16, 0.98], [3.02, -0.74], [3.14, -0.96], [3.02, -1.32], [0.16, -0.96]
  ], 0.11)
  const right = new THREE.Group()
  right.add(mesh(wingGeo, wingMat))
  right.position.set(0, 1.44, 0.05)
  right.rotation.z = -0.07
  g.add(right)
  const left = new THREE.Group()
  const leftWing = mesh(wingGeo, wingMat)
  leftWing.scale.x = -1
  left.add(leftWing)
  left.position.set(0, 1.44, 0.05)
  left.rotation.z = 0.07
  g.add(left)

  // Tailplane, same trick.
  const tailGeo = planform([
    [0.10, 0.42], [1.26, -0.18], [1.32, -0.34], [1.26, -0.56], [0.10, -0.44]
  ], 0.07)
  const tailR = mesh(tailGeo, wingMat, 0, 1.96, -2.42)
  tailR.rotation.z = -0.06
  g.add(tailR)
  const tailL = mesh(tailGeo, wingMat, 0, 1.96, -2.42)
  tailL.scale.x = -1
  tailL.rotation.z = 0.06
  g.add(tailL)

  // Vertical fin: the same planform stood on its span axis, painted in accent.
  const finGeo = planform([
    [0.00, 0.78], [1.14, -0.42], [1.18, -0.62], [1.14, -0.80], [0.00, -0.74]
  ], 0.08)
  const fin = mesh(finGeo, finMat, 0, 1.92, -2.00)
  fin.rotation.z = Math.PI / 2
  g.add(fin)

  // Engines slung under and ahead of the wing.
  const nacelle = new THREE.Group()
  const pod = mesh(new THREE.CylinderGeometry(0.30, 0.26, 0.98, 12), p.body)
  pod.rotation.x = Math.PI / 2
  nacelle.add(pod)
  const lip = mesh(new THREE.CylinderGeometry(0.32, 0.31, 0.10, 12), p.trim, 0, 0, 0.50)
  lip.rotation.x = Math.PI / 2
  nacelle.add(lip)
  nacelle.add(mesh(new THREE.CircleGeometry(0.28, 12), p.dark, 0, 0, 0.49))
  const cone = mesh(new THREE.ConeGeometry(0.22, 0.42, 12), p.trim, 0, 0, -0.66)
  cone.rotation.x = -Math.PI / 2
  nacelle.add(cone)
  nacelle.position.set(1.54, 1.08, 0.58)
  g.add(nacelle)
  g.add(mirrored(nacelle))
  pair(g, box(0.10, 0.42, 0.46, p.body, 1.54, 1.38, 0.40))   // pylon

  // Cabin window line, accent cheatline and cockpit glass.
  pair(g, box(0.05, 0.11, 3.5, p.glass, 0.452, CY + 0.16, -0.35))
  pair(g, box(0.05, 0.07, 3.9, accent, 0.452, CY - 0.02, -0.30))
  const cockpit = box(0.42, 0.17, 0.34, p.glass, 0, CY + 0.17, 2.34)
  cockpit.rotation.x = -0.34
  g.add(cockpit)
  pair(g, box(0.16, 0.09, 0.22, p.glass, 0.20, CY + 0.15, 2.28))

  // Nav lights at the tips, landing light at the nose.
  pair(g, box(0.14, 0.09, 0.14, p.lamp, 3.06, 1.30, -0.90))
  g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), p.lamp, 0, CY - 0.06, 2.88))

  // Gear, so the aircraft actually rests on y=0 when parked.
  const gearLeg = (x, z, len, wr, ww) => {
    const grp = new THREE.Group()
    grp.add(limb([x, wr, z], [x, wr + len, z], 0.055, p.trim, 1))
    grp.add(wheel(p, wr, ww, x, wr, z))
    return grp
  }
  g.add(gearLeg(0, 2.10, 1.00, 0.17, 0.14))
  g.add(gearLeg(0.86, -0.15, 0.82, 0.21, 0.18))
  g.add(gearLeg(-0.86, -0.15, 0.82, 0.21, 0.18))
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

/**
 * Dispose geometries/materials so swapping vehicles does not leak GPU memory.
 * Uses sets because geometry and materials are deliberately shared between
 * meshes (both wings use one geometry, every panel shares one material).
 */
export function disposeVehicle (group) {
  const geometries = new Set()
  const materials = new Set()
  group.traverse(o => {
    if (o.userData?.extraMaterials) for (const m of o.userData.extraMaterials) materials.add(m)
    if (!o.isMesh) return
    if (o.geometry) geometries.add(o.geometry)
    if (Array.isArray(o.material)) o.material.forEach(m => m && materials.add(m))
    else if (o.material) materials.add(o.material)
  })
  for (const gm of geometries) gm.dispose()
  for (const m of materials) m.dispose()
}
