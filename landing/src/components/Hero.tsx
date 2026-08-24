import { Section } from './shared/Section'
import { delay } from './shared/stagger'
import { StudioDemo } from './hero/StudioDemo'

export function Hero() {
  return (
    <Section id="top" className="hero is-in">
      <div className="shell hero__grid">
        {/* ── The claim ── */}
        <div>
          <p className="note rv" style={delay(0)}>
            <span className="note-rule" />
            Closed beta · V1 in development
          </p>

          <h1 className="t-hero hero__claim rv mt-5" style={delay(1)}>
            Design the interface. Weave the system.
          </h1>

          <p className="t-lead hero__lead rv mt-7 text-ink-2" style={delay(2)}>
            A visual programming language with Figma-style design tools. Draw the screens, wire the
            logic, and compile a real Vite + React + TypeScript codebase you own outright.
          </p>

          <div className="hero__actions rv mt-9" style={delay(3)}>
            <a className="btn-primary" href="#access">
              Request access
            </a>
            <a className="btn-quiet" href="#language">
              See the language
            </a>
          </div>
        </div>

        {/* ── The artefact: an operable miniature of the studio ── */}
        <div className="rv" style={delay(4)}>
          <StudioDemo />
        </div>
      </div>
    </Section>
  )
}
