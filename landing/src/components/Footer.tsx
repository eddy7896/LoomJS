import { LoomLogo } from './shared/LoomLogo'

const FOOTER_LINKS = [
  { label: 'System Context', href: 'https://github.com/eddy7896/LoomJS/blob/main/docs/01-system-context.md' },
  { label: 'Architecture', href: 'https://github.com/eddy7896/LoomJS/blob/main/docs/02-system-architecture.md' },
  { label: 'V1 Scope', href: 'https://github.com/eddy7896/LoomJS/blob/main/docs/07-v1-scope.md' },
  { label: 'Glossary', href: 'https://github.com/eddy7896/LoomJS/blob/main/docs/06-glossary.md' },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-hair pt-14 pb-10" id="footer">
      <div className="w-full max-w-[1200px] mx-auto px-5 sm:px-10">
        <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr] gap-12 pb-10 border-b border-hair mb-6">
          <div className="flex flex-col gap-4">
            <LoomLogo size={28} />
            <p className="font-body text-[14px] text-ink max-w-[320px]">
              A visual programming language with Figma-style design tools.<br />
              Build full-stack web apps by designing and wiring.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-heading font-extrabold text-[12px] tracking-[0.04em] uppercase text-ink-3 mb-1">Documentation</span>
            <div className="flex flex-col gap-2">
              {FOOTER_LINKS.map(link => (
                <a
                  key={link.label}
                  href={link.href}
                  className="font-body text-[14px] font-medium text-ink-2 transition-colors hover:text-brand w-fit"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="font-heading font-extrabold text-[12px] tracking-[0.04em] uppercase text-ink-3 mb-1">Project</span>
            <div className="flex flex-col gap-2">
              <a href="https://github.com/eddy7896/LoomJS" className="font-body text-[14px] font-medium text-ink-2 transition-colors hover:text-brand w-fit" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href="#waitlist" className="font-body text-[14px] font-medium text-ink-2 transition-colors hover:text-brand w-fit">
                Request access
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-wrap">
          <span className="font-mono text-[12px] text-ink-3">
            © {year} loomJS
          </span>
          <span className="font-mono text-[11px] text-ink-3">
            Built on the Modernist design system · Archivo + JetBrains Mono · designed for designers
          </span>
        </div>
      </div>
    </footer>
  )
}
