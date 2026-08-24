import { Section } from './shared/Section'
import { delay } from './shared/stagger'

const LOOM = [
  ['The canvas', 'design + nodes'],
  ['The compiler', 'graph → files'],
  ['Preview', 'runs your app live'],
]

const YOURS = [
  ['The codebase', 'Vite + React + TS'],
  ['The database', 'your Supabase'],
  ['Auth', 'your Supabase'],
  ['The deployment', 'your Vercel'],
  ['The secrets', 'server-only, by name'],
]

const SPEC: [string, string, string][] = [
  ['Frontend', 'Vite + React + TypeScript', 'SPA, react-router'],
  ['Backend', 'Vercel serverless functions', '/api routes'],
  ['Database + auth', 'Your own Supabase', 'Postgres, relational, RLS'],
  ['Styling', 'Tailwind CSS + shadcn/ui', 'brand tokens drive the theme'],
  ['Types', 'TypeScript throughout', 'Supabase-generated, tsc authoritative'],
  ['Deploy', 'Your own Vercel', 'managed deploy connector'],
]

export function Ownership() {
  return (
    <Section id="ownership" className="section">
      <div className="shell">
        <div className="section__head">
          <div className="max-w-[26ch]">
            <h2 className="t-section rv">Bring your own backend.</h2>
          </div>
          <p className="t-lead rv text-ink-2" style={delay(1)}>
            loomJS owns the building experience. You own everything the app runs on. There is a wall
            between the two and nothing crosses it, which is the only honest answer to &ldquo;am I
            locked in?&rdquo;
          </p>
        </div>

        <div className="byo rv" style={delay(2)}>
          <div className="byo__side">
            <p className="byo__owner">loomJS owns</p>
            <div className="byo__list">
              {LOOM.map(([label, note]) => (
                <div className="byo__item" key={label}>
                  <b>{label}</b>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="byo__side byo__side--yours">
            <p className="byo__owner">You own</p>
            <div className="byo__list">
              {YOURS.map(([label, note]) => (
                <div className="byo__item" key={label}>
                  <b>{label}</b>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="note mt-5 rv" style={delay(3)}>
          loom never hosts your app&rsquo;s data. It brokers your credentials to reach your Supabase
          during Preview and injects them into Vercel at deploy, by name reference only.
        </p>

        <div className="mt-20 rv" style={delay(4)}>
          <p className="note mb-4">
            <span className="note-rule" />
            What Compile actually writes
          </p>
          <div className="spec">
            {SPEC.map(([key, value, note]) => (
              <div className="spec__row" key={key}>
                <span className="spec__key">{key}</span>
                <span className="spec__val">{value}</span>
                <span className="spec__note">{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}
