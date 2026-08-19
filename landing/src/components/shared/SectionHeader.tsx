import { motion } from 'framer-motion'

interface SectionHeaderProps {
  number: string
  label: string
  title: string
  description: string
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
}

export function SectionHeader({ number, label, title, description }: SectionHeaderProps) {
  return (
    <motion.div 
      className="mb-10"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-100px" }}
      variants={{
        show: { transition: { staggerChildren: 0.1 } }
      }}
    >
      <motion.div variants={fadeUp} className="flex items-center gap-2.5 mb-3.5">
        <span className="font-mono font-bold text-[11px] text-brand leading-none">{number}</span>
        <span className="font-heading font-bold text-[11px] tracking-[0.16em] uppercase text-ink-3 leading-none">{label}</span>
        <span className="flex-1 h-px bg-hair-2" />
      </motion.div>
      <motion.h2 variants={fadeUp} className="font-heading font-extrabold text-[clamp(24px,3.5vw,32px)] leading-[1.1] tracking-[-0.02em] text-ink mb-2">
        {title}
      </motion.h2>
      <motion.p variants={fadeUp} className="font-body text-[15px] leading-[1.62] text-ink-2 max-w-[640px]">
        {description}
      </motion.p>
    </motion.div>
  )
}
