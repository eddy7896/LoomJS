import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LoomLogo } from './shared/LoomLogo'

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Nodes', href: '#nodes' },
  { label: 'Stack', href: '#stack' },
]

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [showFloat, setShowFloat] = useState(false)
  const [activeSection, setActiveSection] = useState('')

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40)
      setShowFloat(window.scrollY > 500)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Track active section
  useEffect(() => {
    const sections = ['how-it-works', 'features', 'nodes', 'stack', 'for-designers', 'waitlist']
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    )

    sections.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* Top bar — logo only */}
      <motion.nav
        className={`top-nav ${scrolled ? 'scrolled' : ''}`}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
      >
        <a href="#" aria-label="loomJS home">
          <LoomLogo size={30} />
        </a>
        <a
          href="#waitlist"
          className="hidden sm:inline-flex items-center gap-2 font-heading font-bold text-[13px] text-ink-2 border border-hair-2 rounded-[10px] px-4 py-2 transition-all hover:border-brand hover:text-brand"
        >
          Join waitlist
        </a>
      </motion.nav>

      {/* Floating nav pill — appears after scroll */}
      <AnimatePresence>
        {showFloat && (
          <motion.div
            className="floating-nav"
            initial={{ opacity: 0, y: 40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.9 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <a href="#" className="flex items-center pl-2 pr-3 shrink-0" aria-label="Back to top">
              <LoomLogo size={22} variant="light" />
            </a>
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`floating-nav-link ${activeSection === link.href.slice(1) ? 'active' : ''}`}
              >
                {link.label}
              </a>
            ))}
            <a href="#waitlist" className="floating-nav-cta">
              Get access
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
