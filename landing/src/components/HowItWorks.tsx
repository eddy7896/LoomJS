import { motion } from 'framer-motion'
import { SectionHeader } from './shared/SectionHeader'

const STEPS = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" />
      </svg>
    ),
    title: 'Design',
    description: 'Drag components onto artboards. Style everything in the inspector. Draw flow arrows between screens.',
    color: 'var(--color-node-ui)',
    fill: 'var(--color-node-ui-fill)',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" />
      </svg>
    ),
    title: 'Wire',
    description: 'Connect nodes port-to-port in the backend graph. Data flows along wires. Color tells you the type.',
    color: 'var(--color-node-fn)',
    fill: 'var(--color-node-fn-fill)',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    title: 'Compile',
    description: 'Generate a real Vite + React + TypeScript codebase. Node-to-code lineage you can trace and trust.',
    color: 'var(--color-node-api)',
    fill: 'var(--color-node-api-fill)',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
    title: 'Deploy',
    description: 'Ship to your own Vercel. Preview runs live against your Supabase. You own the code, the data, everything.',
    color: 'var(--color-node-st)',
    fill: 'var(--color-node-st-fill)',
  },
]

const containerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.15,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
}

export function HowItWorks() {
  return (
    <section className="py-[clamp(64px,10vw,100px)] bg-panel border-y border-hair" id="how-it-works">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <SectionHeader
          number="01"
          label="How it works"
          title="Four steps from canvas to production"
          description="loomJS compiles your visual design into a real, runnable, fully-owned codebase. No syntax to learn — functions are node cards, data flow is drag-and-drop wires."
        />

        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          {STEPS.map((step, i) => (
            <motion.div key={step.title} variants={itemVariants} className="relative p-6 rounded-xl bg-canvas border border-hair">
              <div className="w-11 h-11 rounded-md grid place-items-center mb-4" style={{ background: step.fill, color: step.color }}>
                <div className="w-5.5 h-5.5 [&>svg]:w-full [&>svg]:h-full">{step.icon}</div>
              </div>
              <div className="font-mono font-bold text-[11px] mb-1.5" style={{ color: step.color }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="font-heading font-extrabold text-[18px] leading-[1.2] tracking-[-0.01em] text-ink mb-1.5">{step.title}</h3>
              <p className="font-body text-[14px] leading-[1.62] text-ink-2 mt-1.5">{step.description}</p>

              {i < STEPS.length - 1 && (
                <div className="absolute right-[-32px] top-[38px] z-10 hidden lg:block" aria-hidden="true">
                  <svg width="40" height="16" viewBox="0 0 40 16" fill="none">
                    <path d="M0 8h32M28 3l6 5-6 5" stroke="var(--color-hair-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
