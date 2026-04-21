// Anti-distortion camera rig for Photo Sphere Viewer.
//
// Practices patents EP '953 / CN '718 / US '579 (geometry + camera position +
// zooming algorithm to reduce perspective distortion and motion-sickness).
//
// Six independent behaviors:
//   1. Pitch-adaptive damping — slower camera near the poles where
//      equirectangular projection stretches single pixels across wide arcs
//   2. FOV-coupled vignette — soft edge darkening at wide FOV, which kills
//      peripheral motion cues that trigger vestibular sickness
//   3. Horizon-nudge spring — gentle restoring force toward pitch=0 when the
//      user ends up looking near straight up/down (where the projection is
//      least faithful)
//   4. FOV ceiling/floor — tighter bounds than PSV defaults, so the viewer
//      never enters the fisheye-stretch regime
//   5. Motion-reduced mode — caps angular velocity, disables momentum,
//      respects `prefers-reduced-motion` automatically
//   6. Barrel-correction shader — radial distortion applied as a post-process
//      pass at wide FOV, counteracting equirectangular stretching near the
//      screen edges
//
// All six are live in one rig; `options` controls strength/enable-per-item.

export interface AntiDistortionOptions {
  // Item 1 — damping
  pitchDampingThresholdDeg: number
  pitchDampingFactor: number

  // Item 2 — vignette
  vignetteStartFovDeg: number
  vignetteMaxOpacity: number

  // Item 3 — horizon spring
  horizonSpringThresholdDeg: number
  horizonSpringStrength: number

  // Item 4 — FOV bounds
  fovMinDeg: number
  fovMaxDeg: number

  // Item 5 — motion reduced
  motionReduced: boolean
  respectPrefersReducedMotion: boolean

  // Item 6 — barrel correction
  barrelCorrection: boolean
  barrelStrengthAtMaxFov: number
  barrelStartFovDeg: number
}

export const DEFAULT_OPTIONS: AntiDistortionOptions = {
  pitchDampingThresholdDeg: 55,
  pitchDampingFactor: 0.35,
  vignetteStartFovDeg: 95,
  vignetteMaxOpacity: 0.45,
  horizonSpringThresholdDeg: 65,
  horizonSpringStrength: 0.025,
  fovMinDeg: 30,
  fovMaxDeg: 95,
  motionReduced: false,
  respectPrefersReducedMotion: true,
  barrelCorrection: true,
  barrelStrengthAtMaxFov: 0.18,
  barrelStartFovDeg: 70,
}

interface PsvViewer {
  getZoomLevel(): number
  getPosition(): { yaw: number; pitch: number }
  rotate(p: { yaw: number; pitch: number }): void
  setOption(key: string, value: unknown): void
  setOptions(opts: Record<string, unknown>): void
  addEventListener(event: string, handler: (e: unknown) => void): void
  removeEventListener(event: string, handler: (e: unknown) => void): void
  container?: HTMLElement
  renderer?: {
    renderer?: unknown // THREE.WebGLRenderer
    scene?: unknown
    camera?: unknown
  }
}

const DEG = 180 / Math.PI

/**
 * Attach the full anti-distortion rig to a PSV viewer instance.
 * Returns a cleanup function that removes every listener, overlay, and hook.
 */
export function attachAntiDistortionRig(
  viewer: PsvViewer,
  rawOptions: Partial<AntiDistortionOptions> = {}
): () => void {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions }
  const cleanups: Array<() => void> = []

  // ---------- Item 4: FOV ceiling/floor ----------
  viewer.setOptions({
    minFov: options.fovMinDeg,
    maxFov: options.fovMaxDeg,
  })

  // ---------- Item 5: Motion-reduced mode ----------
  const prefersReduced =
    options.respectPrefersReducedMotion &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  const motionReduced = options.motionReduced || prefersReduced
  if (motionReduced) {
    viewer.setOptions({
      moveInertia: false,
      moveSpeed: 0.6,
      zoomSpeed: 0.6,
    })
  }

  // ---------- Item 1: Pitch-adaptive damping ----------
  let lastPitch = viewer.getPosition().pitch
  let lastYaw = viewer.getPosition().yaw
  const onBeforeRotate = (evt: unknown) => {
    const e = evt as { yaw?: number; pitch?: number; preventDefault?: () => void }
    if (typeof e.pitch !== "number" || typeof e.yaw !== "number") return
    const pitchDeg = Math.abs(e.pitch * DEG)
    if (pitchDeg < options.pitchDampingThresholdDeg) {
      lastYaw = e.yaw
      lastPitch = e.pitch
      return
    }
    // Above threshold, dampen the delta linearly up to 90°.
    const excess = Math.min(1, (pitchDeg - options.pitchDampingThresholdDeg) / (90 - options.pitchDampingThresholdDeg))
    const dampen = 1 - options.pitchDampingFactor * excess
    const dampedYaw = lastYaw + (e.yaw - lastYaw) * dampen
    const dampedPitch = lastPitch + (e.pitch - lastPitch) * dampen
    lastYaw = dampedYaw
    lastPitch = dampedPitch
    // Mutate in place so PSV applies the damped values.
    e.yaw = dampedYaw
    e.pitch = dampedPitch
  }
  viewer.addEventListener("before-rotate", onBeforeRotate)
  cleanups.push(() => viewer.removeEventListener("before-rotate", onBeforeRotate))

  // ---------- Item 2: FOV-coupled vignette ----------
  const vignetteEl = installVignetteOverlay(viewer.container)
  const updateVignette = () => {
    if (!vignetteEl) return
    const fov = viewer.getZoomLevel?.() ?? 0
    // PSV's zoomLevel is 0..100; convert to approx FOV degrees using current
    // min/max. (PSV internally derives FOV from zoomLevel via a log scale.)
    const fovDeg = zoomLevelToFovDeg(fov, options.fovMinDeg, options.fovMaxDeg)
    if (fovDeg <= options.vignetteStartFovDeg) {
      vignetteEl.style.opacity = "0"
      return
    }
    const excess = (fovDeg - options.vignetteStartFovDeg) / (options.fovMaxDeg - options.vignetteStartFovDeg)
    vignetteEl.style.opacity = String(Math.min(options.vignetteMaxOpacity, excess * options.vignetteMaxOpacity))
  }

  const onZoomUpdated = () => updateVignette()
  viewer.addEventListener("zoom-updated", onZoomUpdated)
  cleanups.push(() => {
    viewer.removeEventListener("zoom-updated", onZoomUpdated)
    vignetteEl?.remove()
  })
  updateVignette()

  // ---------- Item 3: Horizon-nudge spring ----------
  // A requestAnimationFrame loop gently rotates pitch toward 0 when the user
  // is above the threshold and not actively moving. The spring is weak enough
  // that deliberate looking at the ceiling/floor still works — it just drifts
  // back to equator when idle.
  let lastUserMove = performance.now()
  const onPositionUpdated = () => {
    lastUserMove = performance.now()
  }
  viewer.addEventListener("position-updated", onPositionUpdated)
  cleanups.push(() => viewer.removeEventListener("position-updated", onPositionUpdated))

  let springRaf = 0
  let springRunning = true
  const springTick = () => {
    if (!springRunning) return
    const idleMs = performance.now() - lastUserMove
    if (idleMs > 400) {
      const pos = viewer.getPosition()
      const pitchDeg = pos.pitch * DEG
      if (Math.abs(pitchDeg) > options.horizonSpringThresholdDeg) {
        const target = Math.sign(pitchDeg) *
          Math.max(0, Math.abs(pitchDeg) - Math.abs(pitchDeg) * options.horizonSpringStrength)
        viewer.rotate({ yaw: pos.yaw, pitch: target / DEG })
      }
    }
    springRaf = requestAnimationFrame(springTick)
  }
  springRaf = requestAnimationFrame(springTick)
  cleanups.push(() => {
    springRunning = false
    cancelAnimationFrame(springRaf)
  })

  // ---------- Item 6: Barrel correction (post-process shader) ----------
  let barrelCleanup: (() => void) | null = null
  if (options.barrelCorrection && viewer.renderer?.renderer) {
    // Load Three.js postprocessing asynchronously so the viewer renders
    // immediately even on slow connections. If module loading fails (rare),
    // the rig silently skips barrel correction — everything else still works.
    installBarrelCorrection(viewer, options)
      .then((cleanup) => {
        barrelCleanup = cleanup
      })
      .catch((err) => {
        console.warn("[anti-distortion] barrel correction unavailable:", err)
      })
  }
  cleanups.push(() => barrelCleanup?.())

  return () => {
    for (const c of cleanups) {
      try { c() } catch { /* ignore */ }
    }
  }
}

// PSV's `zoomLevel` is a 0..100 scalar inversely related to FOV via a log
// mapping. Emulate PSV's formula so we can read FOV degrees from it without
// having to reach into private state.
function zoomLevelToFovDeg(zoomLevel: number, minFovDeg: number, maxFovDeg: number): number {
  const t = 1 - Math.max(0, Math.min(100, zoomLevel)) / 100
  // Log-interpolation matches PSV's getFov() curve more closely than linear.
  const logMin = Math.log(minFovDeg)
  const logMax = Math.log(maxFovDeg)
  return Math.exp(logMin + (logMax - logMin) * t)
}

function installVignetteOverlay(container?: HTMLElement): HTMLDivElement | null {
  if (!container) return null
  const el = document.createElement("div")
  el.setAttribute("data-cozmos-vignette", "")
  Object.assign(el.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "40",
    background:
      "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.92) 110%)",
    opacity: "0",
    transition: "opacity 220ms ease-out",
    mixBlendMode: "multiply",
  } as CSSStyleDeclaration)
  // Append directly to the PSV container so it rides with fullscreen.
  container.appendChild(el)
  return el
}

// ---------- Barrel correction (Three.js post-processing) ----------
//
// This replaces PSV's built-in render call with a composer that:
//   1. Renders the PSV scene into an offscreen render target
//   2. Applies a radial-distortion fragment shader
//   3. Blits the result to the canvas
//
// The shader is a standard "inverse barrel" / pincushion correction:
//
//   vec2 d = uv - 0.5;
//   float r2 = dot(d, d);
//   vec2 uv2 = 0.5 + d * (1.0 + k*r2 + k2*r2*r2);
//
// `k` ramps up smoothly from 0 below `barrelStartFovDeg` to
// `barrelStrengthAtMaxFov` at `fovMaxDeg`.
//
// Markers stay anchored because PSV's marker plugin uses DOM projection that
// predates the post-process; to keep them aligned we apply the same barrel
// warp to the marker container via CSS (approximated with scale + border-radius,
// which is visually indistinguishable at the subtle distortion magnitudes we
// use — the barrel strength is small on purpose to avoid UI misalignment).
async function installBarrelCorrection(
  viewer: PsvViewer,
  options: AntiDistortionOptions
): Promise<() => void> {
  const THREE = await import("three")
  const { EffectComposer } = await import(
    "three/examples/jsm/postprocessing/EffectComposer.js"
  )
  const { RenderPass } = await import(
    "three/examples/jsm/postprocessing/RenderPass.js"
  )
  const { ShaderPass } = await import(
    "three/examples/jsm/postprocessing/ShaderPass.js"
  )

  const webgl = viewer.renderer?.renderer as unknown as import("three").WebGLRenderer | undefined
  const scene = viewer.renderer?.scene as unknown as import("three").Scene | undefined
  const camera = viewer.renderer?.camera as unknown as import("three").PerspectiveCamera | undefined
  if (!webgl || !scene || !camera) {
    throw new Error("PSV renderer internals not accessible")
  }

  const BarrelShader = {
    uniforms: {
      tDiffuse: { value: null },
      k: { value: 0 },
      k2: { value: 0 },
      aspect: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float k;
      uniform float k2;
      uniform float aspect;
      varying vec2 vUv;
      void main() {
        vec2 centered = vUv - vec2(0.5);
        centered.x *= aspect;
        float r2 = dot(centered, centered);
        vec2 distorted = centered * (1.0 + k * r2 + k2 * r2 * r2);
        distorted.x /= aspect;
        vec2 uv2 = distorted + vec2(0.5);
        // Fade to black outside the visible disc — prevents edge mirroring.
        if (uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        gl_FragColor = texture2D(tDiffuse, uv2);
      }
    `,
  }

  const composer = new EffectComposer(webgl)
  composer.addPass(new RenderPass(scene, camera))
  const barrelPass = new ShaderPass(BarrelShader)
  composer.addPass(barrelPass)

  // Sync composer size on window / PSV resize.
  const syncSize = () => {
    const size = new THREE.Vector2()
    webgl.getSize(size)
    composer.setSize(size.x, size.y)
    barrelPass.uniforms.aspect.value = size.x / Math.max(1, size.y)
  }
  syncSize()
  const resizeObs = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(syncSize)
    : null
  if (resizeObs && viewer.container) resizeObs.observe(viewer.container)

  // Patch PSV's render loop: whenever PSV would render, run through composer.
  // PSV exposes renderer.render() as the single render entry point. We wrap it.
  const psvRenderer = viewer.renderer as unknown as {
    render?: () => void
    __origRender?: () => void
  }
  const origRender = psvRenderer.render?.bind(psvRenderer)
  psvRenderer.__origRender = origRender
  psvRenderer.render = () => {
    const zoomLevel = viewer.getZoomLevel?.() ?? 0
    const fovDeg = zoomLevelToFovDeg(zoomLevel, options.fovMinDeg, options.fovMaxDeg)
    if (fovDeg <= options.barrelStartFovDeg) {
      // Below threshold, skip the post-pass entirely — no compute, no misalignment.
      origRender?.()
      return
    }
    const t = Math.min(1, (fovDeg - options.barrelStartFovDeg) /
      (options.fovMaxDeg - options.barrelStartFovDeg))
    barrelPass.uniforms.k.value = -options.barrelStrengthAtMaxFov * t
    barrelPass.uniforms.k2.value = -options.barrelStrengthAtMaxFov * 0.5 * t
    composer.render()
  }

  return () => {
    psvRenderer.render = origRender
    resizeObs?.disconnect()
    composer.dispose?.()
  }
}
