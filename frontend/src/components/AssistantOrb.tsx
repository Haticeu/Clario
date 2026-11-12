import { useEffect, useId, useRef } from 'react'

export type OrbState = 'idle' | 'thinking' | 'happy'

interface AssistantOrbProps {
  size: number
  state?: OrbState
  /** Gözler fare imlecini takip etsin mi? */
  tracking?: boolean
}

/** Gözlerin merkezden en fazla kayabileceği mesafe (SVG birimi). */
const MAX_LOOK = 4
/** İmleç bu mesafeden (px) uzaktaysa gözler en uca bakar. */
const LOOK_RANGE = 320

/**
 * Clario asistanının karakteri: gözleri olan, logodaki turkuaz tonlarında parlak bir küre.
 * Boştayken göz kırpar ve imleci izler; düşünürken etrafında bir halka döner ve gözleri
 * sağa sola bakar; cevap verince zıplayıp gülümser. Animasyonlar index.css'te.
 */
export function AssistantOrb({ size, state = 'idle', tracking = false }: AssistantOrbProps) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, '')

  useEffect(() => {
    const el = ref.current
    if (!tracking || !el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect()
        const dx = event.clientX - (rect.left + rect.width / 2)
        const dy = event.clientY - (rect.top + rect.height / 2)
        const distance = Math.hypot(dx, dy) || 1
        const strength = Math.min(1, distance / LOOK_RANGE) * MAX_LOOK
        el.style.setProperty('--look-x', `${((dx / distance) * strength).toFixed(2)}px`)
        el.style.setProperty('--look-y', `${((dy / distance) * strength).toFixed(2)}px`)
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [tracking])

  return (
    <div ref={ref} className="orb" data-state={state} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-body`} cx="0.38" cy="0.3" r="0.78">
            <stop offset="0%" stopColor="#a8f8e2" />
            <stop offset="28%" stopColor="#44e2bd" />
            <stop offset="66%" stopColor="#1bb3a3" />
            <stop offset="100%" stopColor="#0b6671" />
          </radialGradient>
          <radialGradient id={`${id}-shade`} cx="0.5" cy="0.25" r="0.85">
            <stop offset="62%" stopColor="#04192a" stopOpacity="0" />
            <stop offset="100%" stopColor="#04192a" stopOpacity="0.45" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="50" r="44" fill={`url(#${id}-body)`} />
        <circle cx="50" cy="50" r="44" fill={`url(#${id}-shade)`} />
        <circle cx="50" cy="50" r="43.2" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.2" />

        {/* Parlama */}
        <ellipse cx="35" cy="26" rx="13" ry="7" fill="#ffffff" opacity="0.5" transform="rotate(-28 35 26)" />
        <circle cx="58" cy="19" r="2.4" fill="#ffffff" opacity="0.45" />

        <g className="orb-face">
          <ellipse className="orb-cheek" cx="31" cy="61" rx="5" ry="3" />
          <ellipse className="orb-cheek" cx="69" cy="61" rx="5" ry="3" />
          <g className="orb-eye">
            <rect x="35" y="39" width="9.5" height="16" rx="4.75" fill="#0c1c2c" />
            <circle cx="41.2" cy="43.5" r="1.8" fill="#ffffff" />
          </g>
          <g className="orb-eye">
            <rect x="55.5" y="39" width="9.5" height="16" rx="4.75" fill="#0c1c2c" />
            <circle cx="61.7" cy="43.5" r="1.8" fill="#ffffff" />
          </g>
          <path className="orb-mouth orb-mouth-idle" d="M44 64 Q50 68.5 56 64" />
          <path className="orb-mouth orb-mouth-happy" d="M41.5 62.5 Q50 72 58.5 62.5 Z" />
        </g>
      </svg>
    </div>
  )
}
