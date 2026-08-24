import { LoomLogo } from './shared/LoomLogo'

const REPO = 'https://github.com/eddy7896/LoomJS'

const DOCS = [
  { label: 'System context', href: `${REPO}/blob/main/docs/01-system-context.md` },
  { label: 'Architecture', href: `${REPO}/blob/main/docs/02-system-architecture.md` },
  { label: 'V1 scope', href: `${REPO}/blob/main/docs/07-v1-scope.md` },
  { label: 'Glossary', href: `${REPO}/blob/main/docs/06-glossary.md` },
]

const PROJECT = [
  { label: 'GitHub', href: REPO, external: true },
  { label: 'Request access', href: '#access', external: false },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="foot" id="footer">
      <div className="shell">
        <div className="foot__grid">
          <div>
            <LoomLogo size={24} />
            <p className="t-body text-ink-2 mt-4 max-w-[38ch]">
              A visual programming language with Figma-style design tools. Design the interface,
              weave the system, keep the code.
            </p>
          </div>

          <div>
            <p className="foot__col-title">Documentation</p>
            {DOCS.map((link) => (
              <a
                className="foot__link"
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div>
            <p className="foot__col-title">Project</p>
            {PROJECT.map((link) => (
              <a
                className="foot__link"
                key={link.label}
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="foot__base">
          <span>© {year} loomJS · closed beta</span>
          <span>Archivo + JetBrains Mono · light mode, on purpose</span>
        </div>
      </div>
    </footer>
  )
}
