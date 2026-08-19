import { motion } from 'framer-motion'
import { SectionHeader } from './shared/SectionHeader'

const FEATURES = [
  {
    tag: 'BYO-BACKEND',
    title: 'Your stack. Your data. Your code.',
    description:
      'Connect your own Supabase for the database and auth. Deploy to your own Vercel. loomJS generates the app and wires it to your infrastructure — it never hosts your data.',
    accent: 'var(--color-node-db)',
    accentFill: 'var(--color-node-db-fill)',
    visual: (
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border font-heading font-extrabold text-[12px] whitespace-nowrap bg-[var(--color-node-db-fill)] text-[var(--color-node-db)] border-[var(--color-node-db-bd)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" /></svg>
          Your Supabase
        </div>
        <svg width="2" height="20" className="shrink-0"><line x1="1" y1="0" x2="1" y2="20" stroke="var(--color-hair-2)" strokeWidth="2" strokeDasharray="4 3" /></svg>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border font-heading font-extrabold text-[12px] whitespace-nowrap bg-canvas text-ink-2 border-hair-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" /><line x1="12" y1="22" x2="12" y2="15.5" /><polyline points="22 8.5 12 15.5 2 8.5" /></svg>
          Your Vercel
        </div>
      </div>
    ),
  },
  {
    tag: 'REAL CODE',
    title: 'Not a locked-in runtime.',
    description:
      'Compile generates a real Vite + React + TypeScript repo. Read it, edit it, ship it anywhere. Node-to-code lineage means you can trace every line back to the node that created it.',
    accent: 'var(--color-node-api)',
    accentFill: 'var(--color-node-api-fill)',
    visual: (
      <div className="code-block w-full max-w-[320px] lg:w-[280px]">
        <div className="code-bar">
          <span className="code-dot" /><span className="code-dot" /><span className="code-dot" />
          <span className="code-filename">LoginScreen.tsx</span>
        </div>
        <pre className="code-content">
          <code>
            <span className="ck">export function</span> <span className="cf">LoginScreen</span>() {'{\n'}
            {'  '}<span className="ck">const</span> [email, setEmail] = <span className="cf">useState</span>(<span className="cs">''</span>){'\n'}
            {'  '}<span className="ck">const</span> {'{ '}<span className="cf">mutate</span>{' }'} = <span className="cf">useLogin</span>(){'\n'}
            {'  '}<span className="ck">return</span> {'<'}<span className="ct">Form</span> <span className="ca">onSubmit</span>={'{mutate}'}{'>'}...{'\n'}
            {'}'}
          </code>
        </pre>
      </div>
    ),
  },
  {
    tag: 'ONE CANVAS',
    title: 'A designer should never feel they left the canvas.',
    description:
      'Design mode is your Figma-style frontend editor. Switch to Nodes mode for the backend graph. Every component you place gets a mirror node — the UI and logic are always connected.',
    accent: 'var(--color-node-ui)',
    accentFill: 'var(--color-node-ui-fill)',
    visual: (
      <div className="flex items-center">
        <div className="mode-toggle">
          <span className="mode-tab mode-tab-active">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><path d="M2 2l7.586 7.586" /><circle cx="11" cy="11" r="2" /></svg>
            Design
          </span>
          <span className="mode-tab">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" /></svg>
            Nodes
          </span>
        </div>
      </div>
    ),
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

export function Features() {
  return (
    <section className="py-[clamp(64px,10vw,100px)]" id="features">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <SectionHeader
          number="02"
          label="Features"
          title="Built different"
          description="loomJS is a visual programming language — not an app builder that traps you in a runtime. You own the code, the database, and the deployment."
        />

        <motion.div 
          className="grid grid-cols-1 lg:grid-cols-2 gap-5"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          {FEATURES.map((f, i) => (
            <motion.div 
              key={f.tag} 
              variants={itemVariants} 
              className={`flex flex-col sm:flex-row gap-8 p-8 rounded-[16px] bg-panel border border-hair shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.05)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_48px_rgba(0,0,0,0.09)] ${i === FEATURES.length - 1 ? 'lg:col-span-2 lg:flex-row lg:items-center' : ''}`}
            >
              <div className="flex-1">
                <span className="inline-block font-mono text-[11px] font-bold tracking-[0.08em] mb-2.5" style={{ color: f.accent }}>{f.tag}</span>
                <h3 className="font-heading font-extrabold text-[18px] leading-[1.2] tracking-[-0.01em] text-ink mb-2.5">{f.title}</h3>
                <p className="font-body text-[14px] leading-[1.62] text-ink-2">{f.description}</p>
              </div>
              <div className="shrink-0 flex items-center justify-center">
                {f.visual}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
