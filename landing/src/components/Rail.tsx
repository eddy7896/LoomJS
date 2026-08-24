import { useEffect, useState } from 'react'
import { LoomLogo } from './shared/LoomLogo'

const LINKS = [
  { label: 'modes', href: '#modes' },
  { label: 'language', href: '#language' },
  { label: 'compile', href: '#compile' },
  { label: 'ownership', href: '#ownership' },
  { label: 'scope', href: '#scope' },
]

export function Rail() {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`rail ${stuck ? 'is-stuck' : ''}`}>
      <div className="shell rail__inner">
        <a href="#top" aria-label="loomJS, back to top">
          <LoomLogo size={22} />
        </a>

        <nav className="rail__links" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} className="rail__link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <a className="rail__cta" href="#access">
          Request access
        </a>
      </div>
    </header>
  )
}
