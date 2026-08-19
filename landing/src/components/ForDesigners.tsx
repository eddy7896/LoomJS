import { motion } from 'framer-motion'
import { SectionHeader } from './shared/SectionHeader'

const PRINCIPLES = [
  {
    id: 'P1',
    title: 'Design-first, always',
    description:
      'The artboard is home. Logic is generated from what you draw, then shown as cards you can open — never as a wall of text you must write.',
  },
  {
    id: 'P2',
    title: 'One calm surface',
    description:
      'Soft white panels, a single warm red accent, generous radius and hairline borders. Nothing shouts; structure comes from spacing, not heavy rules.',
  },
  {
    id: 'P3',
    title: 'Color means type',
    description:
      'Each node category owns one hue. Color is functional, never decorative — you read a graph by its colors before you read a single label.',
  },
  {
    id: 'P4',
    title: 'Legible by default',
    description:
      'Archivo for interface, JetBrains Mono for anything that is code or data. Ports, wires and states follow one consistent grammar across every view.',
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

export function ForDesigners() {
  return (
    <section className="py-[clamp(64px,10vw,100px)] bg-panel border-y border-hair" id="for-designers">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <SectionHeader
          number="05"
          label="Who it's for"
          title="Made for designers"
          description="UI/UX designers who want to ship real full-stack apps without writing syntax, and who want to own the resulting code and infrastructure."
        />

        <motion.div 
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          {PRINCIPLES.map((p) => (
            <motion.div key={p.id} variants={itemVariants} className="bg-canvas border border-hair rounded-lg px-6 py-[22px]">
              <span className="font-mono font-bold text-[12px] text-brand block mb-2">{p.id}</span>
              <h4 className="font-heading font-extrabold text-[16px] text-ink mb-1.5">{p.title}</h4>
              <p className="font-body text-[13px] leading-[1.55] text-ink-2">{p.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
