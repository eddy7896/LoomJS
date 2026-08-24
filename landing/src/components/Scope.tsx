import { Section } from './shared/Section'
import { delay } from './shared/stagger'

const IN = [
  'Two-mode canvas: drag, wire, schema-driven inspector',
  'Flow arrows compiled to routes and guards',
  'Supabase connector: introspection, typed table nodes, auth and RLS',
  'Vite + React + TypeScript emission with node-to-code lineage',
  'Vercel serverless functions for API and FN nodes',
  'Code node escape hatch with typed ports',
  'Preview running live against your database',
]

const OUT = [
  'Live multiplayer editing (async branch and merge comes later)',
  'Responsive breakpoints: tablet and up for now',
  'React Native, Vue, Svelte, Next.js and RSC',
  'Version history, visual diff, branch and merge',
  'A public module marketplace',
  'Reusable sub-graphs and user-defined nodes',
]

export function Scope() {
  return (
    <Section id="scope" className="section section--tight">
      <div className="shell">
        <div className="section__head section__head--split">
          <h2 className="t-section rv">
            What V1 does,
            <br />
            and what it doesn&rsquo;t.
          </h2>
          <p className="t-body text-ink-2 rv" style={delay(1)}>
            loomJS is a domain-specific language for data-driven web apps: forms, CRUD, dashboards,
            auth. Keeping the node vocabulary small is the reason a graph stays readable once the
            logic gets real. Everything in the right-hand column is a later branch, not a gap we
            are hiding.
          </p>
        </div>

        <div className="honest">
          <div className="honest--in rv" style={delay(2)}>
            <h3 className="honest__title">In the closed beta</h3>
            <ul className="honest__list">
              {IN.map((item) => (
                <li className="honest__row" key={item}>
                  <span className="honest__glyph" aria-hidden="true">
                    +
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="honest--out rv" style={delay(3)}>
            <h3 className="honest__title">Deliberately not yet</h3>
            <ul className="honest__list">
              {OUT.map((item) => (
                <li className="honest__row" key={item}>
                  <span className="honest__glyph" aria-hidden="true">
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  )
}
