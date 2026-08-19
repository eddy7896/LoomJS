import { motion } from 'framer-motion'
import { SectionHeader } from './shared/SectionHeader'

const STACK_ITEMS = [
  {
    label: 'Frontend',
    value: 'Vite + React + TypeScript (SPA)',
    detail: 'react-router',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      </svg>
    ),
  },
  {
    label: 'Backend',
    value: 'Vercel serverless functions',
    detail: '/api routes',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
  },
  {
    label: 'Styling',
    value: 'Tailwind CSS + shadcn/ui',
    detail: 'Brand-token driven theme',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="2.5" /><path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5z" />
      </svg>
    ),
  },
  {
    label: 'Database + Auth',
    value: 'Your own Supabase',
    detail: 'Postgres, relational, RLS',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
      </svg>
    ),
  },
  {
    label: 'Deploy',
    value: 'Your own Vercel',
    detail: 'Managed deploy',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      </svg>
    ),
  },
  {
    label: 'Type layer',
    value: 'TypeScript throughout',
    detail: 'Supabase-generated types',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
]

const containerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
}

export function TechStack() {
  return (
    <section className="py-[clamp(64px,10vw,100px)]" id="stack">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <SectionHeader
          number="04"
          label="Tech stack"
          title="What you get"
          description="When you hit Compile, loomJS generates a complete, professional-grade codebase — the same stack you'd build by hand. No proprietary runtime, no magic."
        />

        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          {STACK_ITEMS.map((item) => (
            <motion.div key={item.label} variants={itemVariants} className="flex items-start gap-3.5 bg-panel border border-hair rounded-xl p-5 transition-all duration-300 hover:shadow-md hover:border-hair-2">
              <div className="w-10 h-10 rounded-md bg-canvas border border-hair grid place-items-center shrink-0 text-ink-2">
                {item.icon}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-mono font-bold text-[10px] tracking-[0.08em] uppercase text-ink-3">{item.label}</span>
                <span className="font-heading font-extrabold text-[14px] text-ink">{item.value}</span>
                <span className="font-mono font-medium text-[11px] text-ink-3">{item.detail}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
