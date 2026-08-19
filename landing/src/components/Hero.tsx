import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

const CHIPS = ['Closed beta', 'Vite + React + TS', 'BYO-backend', 'Zero lock-in']

const stagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
}

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const, delay: 0.3 } },
}

export function Hero() {
  const wireRefs = useRef<SVGPathElement[]>([])

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    wireRefs.current.forEach((path, i) => {
      if (!path) return
      const len = path.getTotalLength()
      path.style.strokeDasharray = `${len}`
      path.style.strokeDashoffset = `${len}`
      path.style.animation = `wire-draw 1.4s ${0.8 + i * 0.3}s cubic-bezier(0.22, 1, 0.36, 1) forwards`
    })
  }, [])

  return (
    <section className="hero-section" id="hero">
      {/* Subtle ambient glow */}
      <div className="hero-glow hero-glow-1" />
      <div className="hero-glow hero-glow-2" />

      <div className="max-w-[1200px] mx-auto px-6 sm:px-10 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-16 items-center">
          {/* ── Content ── */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="flex flex-col"
          >
            <motion.div variants={fadeUp}>
              <div className="hero-badge-pill mb-7">
                <span className="hero-badge-dot" />
                <span className="font-mono font-semibold text-[12px] text-ink-2">
                  Visual programming for designers
                </span>
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="font-heading font-[900] text-[clamp(36px,5.5vw,56px)] leading-[1.04] tracking-[-0.035em] text-ink mb-5"
            >
              Design the interface.
              <br />
              Weave the system.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-ink-2 text-[15.5px] leading-[1.65] max-w-[520px] mb-8"
            >
              A visual programming language with Figma-style design tools — build
              full-stack web apps by designing and wiring, never by writing syntax.
              The compiler generates a real, owned codebase.
            </motion.p>

            <motion.div variants={fadeUp} className="max-w-[460px] mb-6">
              <div className="hero-input-group">
                <input
                  type="email"
                  className="hero-email"
                  placeholder="you@company.com"
                  aria-label="Email address"
                  id="hero-email"
                />
                <button
                  className="hero-submit-btn"
                  id="hero-submit"
                  type="button"
                >
                  Request access
                </button>
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex font-mono font-bold text-[11px] px-3 py-1.5 rounded-lg bg-panel border border-hair-2 text-ink-3"
                >
                  {chip}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* ── Animated Canvas Visual ── */}
          <motion.div
            variants={scaleIn}
            initial="hidden"
            animate="show"
            className="flex items-center justify-center"
          >
            <div className="hero-canvas-wrap dot-grid">
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 420 360"
                fill="none"
                preserveAspectRatio="xMidYMid meet"
              >
                <path
                  ref={(el) => { if (el) wireRefs.current[0] = el }}
                  d="M150 108 C 210 108 210 178 270 178"
                  stroke="var(--color-node-ui)"
                  strokeWidth="2.5"
                />
                <path
                  ref={(el) => { if (el) wireRefs.current[1] = el }}
                  d="M370 178 C 330 178 330 248 280 248"
                  stroke="var(--color-node-fn)"
                  strokeWidth="2.5"
                />
                <path
                  ref={(el) => { if (el) wireRefs.current[2] = el }}
                  d="M140 290 C 80 290 80 178 140 178"
                  stroke="var(--color-node-st)"
                  strokeWidth="2.5"
                  strokeDasharray="6 5"
                />
              </svg>

              {/* Node pills with Framer Motion float */}
              {[
                { label: 'LoginScreen', color: 'var(--color-node-ui)', x: 28, y: 88, delay: 0.6 },
                { label: 'validate()', color: 'var(--color-node-fn)', x: 258, y: 158, delay: 0.8 },
                { label: 'POST /login', color: 'var(--color-node-api)', x: 'auto', y: 228, delay: 1.0, right: 28 },
                { label: 'session', color: 'var(--color-node-st)', x: 68, y: 272, delay: 1.2 },
                { label: 'transactions', color: 'var(--color-node-db)', x: 'auto', y: 88, delay: 1.4, right: 40 },
              ].map((node, i) => (
                <motion.div
                  key={node.label}
                  className="hero-node-pill"
                  style={{
                    left: node.x !== 'auto' ? node.x : undefined,
                    right: node.right,
                    top: node.y,
                  }}
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: [0, -4, 0],
                  }}
                  transition={{
                    opacity: { duration: 0.5, delay: node.delay },
                    scale: { duration: 0.5, delay: node.delay },
                    y: {
                      duration: 5,
                      ease: 'easeInOut',
                      repeat: Infinity,
                      delay: node.delay + i * 0.6,
                    },
                  }}
                >
                  <span className="hero-node-dot" style={{ background: node.color }} />
                  {node.label}
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
