import { motion } from 'framer-motion'
import { SectionHeader } from './shared/SectionHeader'

const NODE_CARDS = [
  {
    name: 'LoginScreen',
    tag: 'UI',
    color: 'var(--color-node-ui)',
    fill: 'var(--color-node-ui-fill)',
    bd: 'var(--color-node-ui-bd)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
      </svg>
    ),
    body: (
      <>
        <div className="ncard-field">email@fintrack.app</div>
        <div className="ncard-field">••••••••</div>
        <div className="ncard-btn" style={{ background: 'var(--color-node-ui)' }}>Sign in</div>
        <div className="ncard-row"><span className="ncard-key">emit</span><span className="ncard-val">onSubmit</span></div>
      </>
    ),
  },
  {
    name: 'validateCredentials',
    tag: 'FN',
    color: 'var(--color-node-fn)',
    fill: 'var(--color-node-fn-fill)',
    bd: 'var(--color-node-fn-bd)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 4v4h4V4" /><path d="M10 20v-4h4v4" /><path d="M2 12h4" /><path d="M18 12h4" />
      </svg>
    ),
    body: (
      <>
        <div className="ncard-row"><span className="ncard-key">in</span><span className="ncard-val">email, password</span></div>
        <div className="ncard-row"><span className="ncard-key">rule</span><span className="ncard-val">regex · len≥8</span></div>
        <div className="ncard-row"><span className="ncard-key">out</span><span className="ncard-val">valid: bool</span></div>
      </>
    ),
  },
  {
    name: 'POST /auth/login',
    tag: 'API',
    color: 'var(--color-node-api)',
    fill: 'var(--color-node-api-fill)',
    bd: 'var(--color-node-api-bd)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    body: (
      <>
        <div className="ncard-row"><span className="ncard-key">body</span><span className="ncard-val">{'{ email, pass }'}</span></div>
        <div className="ncard-row"><span className="ncard-key">sign</span><span className="ncard-val">jwt · 24h</span></div>
        <div className="ncard-row"><span className="ncard-key">200</span><span className="ncard-val">{'{ token }'}</span></div>
      </>
    ),
  },
  {
    name: 'session',
    tag: 'STATE',
    color: 'var(--color-node-st)',
    fill: 'var(--color-node-st-fill)',
    bd: 'var(--color-node-st-bd)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21s-4-3-4-9 4-9 4-9" /><path d="M16 3s4 3 4 9-4 9-4 9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    body: (
      <>
        <div className="ncard-row"><span className="ncard-key">token</span><span className="ncard-val">string</span></div>
        <div className="ncard-row"><span className="ncard-key">user</span><span className="ncard-val">User | null</span></div>
      </>
    ),
  },
  {
    name: 'transactions',
    tag: 'DB',
    color: 'var(--color-node-db)',
    fill: 'var(--color-node-db-fill)',
    bd: 'var(--color-node-db-bd)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" /></svg>
    ),
    body: (
      <>
        <div className="ncard-row"><span className="ncard-key">id</span><span className="ncard-val">uuid pk</span></div>
        <div className="ncard-row"><span className="ncard-key">amount</span><span className="ncard-val">decimal</span></div>
        <div className="ncard-row"><span className="ncard-key">date</span><span className="ncard-val">timestamp</span></div>
      </>
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
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
}

export function NodeShowcase() {
  return (
    <section className="py-[clamp(64px,10vw,100px)] bg-panel border-y border-hair" id="nodes">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <SectionHeader
          number="03"
          label="The visual language"
          title="Five node types. One visual language."
          description="Every node category owns one color. You read a graph by its colors before you read a single label. Nodes are functions, wires are data flow, flow arrows are navigation."
        />

        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          {NODE_CARDS.map((node) => (
            <motion.div key={node.tag} variants={itemVariants} className="ncard">
              <div className="ncard-header" style={{ borderBottomColor: node.bd }}>
                <span className="ncard-icon" style={{ background: node.fill, color: node.color }}>
                  {node.icon}
                </span>
                <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
                <span className="ncard-tag" style={{ background: node.fill, color: node.color }}>
                  {node.tag}
                </span>
              </div>
              <div className="ncard-body">
                {node.body}
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Wire diagram connecting nodes */}
        <motion.div 
          className="wire-pane dot-grid hidden md:block"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] as const, delay: 0.4 }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1100 140" fill="none" preserveAspectRatio="none">
            <path d="M120 50 C 220 50 220 70 320 70" stroke="var(--color-node-ui)" strokeWidth="2.5" />
            <path d="M420 70 C 520 70 520 50 620 50" stroke="var(--color-node-fn)" strokeWidth="2.5" />
            <path d="M420 70 C 520 70 520 100 620 100" stroke="var(--color-node-fn)" strokeWidth="2.5" strokeDasharray="6 5" />
            <path d="M720 50 C 820 50 820 70 920 70" stroke="var(--color-node-api)" strokeWidth="2.5" />
          </svg>
          <div className="wire-pill" style={{ left: 20, top: 36 }}>
            <span className="wire-pill-dot" style={{ background: 'var(--color-node-ui)' }} />LoginScreen
          </div>
          <div className="wire-pill" style={{ left: 310, top: 56 }}>
            <span className="wire-pill-dot" style={{ background: 'var(--color-node-fn)' }} />validate()
          </div>
          <div className="wire-pill" style={{ left: 610, top: 36 }}>
            <span className="wire-pill-dot" style={{ background: 'var(--color-node-api)' }} />POST /login
          </div>
          <div className="wire-pill" style={{ left: 610, top: 86 }}>
            <span className="wire-pill-dot" style={{ background: 'var(--color-node-st)' }} />session
          </div>
          <div className="wire-pill" style={{ left: 910, top: 56 }}>
            <span className="wire-pill-dot" style={{ background: 'var(--color-node-db)' }} />transactions
          </div>
        </motion.div>
      </div>
    </section>
  )
}
