import { motion } from 'framer-motion'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const } },
}

export function WaitlistCTA() {
  return (
    <section className="py-[clamp(80px,12vw,120px)]" id="waitlist">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <motion.div 
          className="bg-brand-tint border border-[#F7C8BD] rounded-2xl md:rounded-[20px] p-8 md:p-14 grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-10 md:gap-12 items-center"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div className="flex flex-col">
            <span className="block font-mono text-[12px] tracking-[0.08em] text-brand mb-3">Closed beta</span>
            <h2 className="font-heading font-extrabold text-[clamp(28px,4vw,36px)] leading-[1.1] tracking-[-0.02em] text-ink mb-3">
              Build apps the way<br />you design them.
            </h2>
            <p className="font-body text-[15px] leading-[1.62] text-ink-2 max-w-[420px]">
              loomJS is heading toward a closed beta. Request early access to be among the first
              designers to build real, full-stack web apps — on a canvas, with zero syntax.
            </p>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3 bg-panel border border-hair rounded-xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex flex-col gap-1">
                <label htmlFor="wl-email" className="font-heading font-extrabold text-[11px] tracking-[0.06em] uppercase text-ink-3">Email</label>
                <input
                  type="email"
                  id="wl-email"
                  className="wl-input"
                  placeholder="you@company.com"
                  aria-label="Email address"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="wl-invite" className="font-heading font-extrabold text-[11px] tracking-[0.06em] uppercase text-ink-3">Invite code</label>
                <input
                  type="text"
                  id="wl-invite"
                  className="wl-input"
                  placeholder="Optional"
                  aria-label="Invite code"
                />
              </div>
              <button 
                className="w-full justify-center py-3.5 mt-1 font-heading font-extrabold text-[15px] text-white bg-brand rounded-lg transition-colors hover:bg-brand-hover"
                id="wl-submit" 
                type="button"
              >
                Request early access
              </button>
            </div>
            <p className="font-mono text-[11px] font-medium text-ink-3 text-center">
              Invite codes available soon · No spam, ever
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
