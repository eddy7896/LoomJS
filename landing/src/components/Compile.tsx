import { Section } from './shared/Section'
import { delay } from './shared/stagger'

const LINES: { no: number; code: React.ReactNode; traced?: boolean }[] = [
  { no: 12, code: <><span className="kw">export function</span> LoginScreen() {'{'}</> },
  { no: 13, code: <>{'  '}<span className="kw">const</span> {'{ mutate, error } = useLogin()'}</> },
  { no: 14, code: <>{'  '}<span className="kw">return</span> {'('}</> },
  { no: 15, code: <>{'    <Form onSubmit={mutate}>'}</>, traced: true },
  { no: 16, code: <>{'      <Field name='}<span className="str">"email"</span>{' type='}<span className="str">"email"</span>{' />'}</> },
  { no: 17, code: <>{'      <Field name='}<span className="str">"password"</span>{' type='}<span className="str">"password"</span>{' />'}</> },
  { no: 18, code: <>{'      <Button>Sign in</Button>'}</> },
  { no: 19, code: <>{'    </Form>'}</> },
  { no: 20, code: <>{'  )'}</> },
  { no: 21, code: <>{'}'}</> },
]

const TREE = [
  'src/screens/LoginScreen.tsx',
  'src/hooks/useLogin.ts',
  'api/auth/login.ts',
  'src/lib/supabase.ts',
  'vite.config.ts',
  'package.json',
]

export function Compile() {
  return (
    <Section id="compile" className="section">
      <div className="shell">
        <div className="section__head section__head--split">
          <h2 className="t-section rv">
            Compile emits files,
            <br />
            not a runtime.
          </h2>
          <div className="rv" style={delay(1)}>
            <p className="t-body text-ink-2">
              The graph is an intermediate representation. Hitting Compile writes a normal Vite +
              React + TypeScript project and Vercel serverless functions, with source maps back to
              the node that produced each line. Open a node, see its code. Open a line, find its
              node.
            </p>
          </div>
        </div>

        <div className="lineage">
          <div className="node rv" style={delay(2)}>
            <div className="node__head">
              <span
                className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                style={{ background: 'var(--color-node-ui)' }}
                aria-hidden="true"
              />
              <span className="node__title">LoginScreen</span>
              <span
                className="node__kind"
                style={{ background: 'var(--color-node-ui-fill)', color: 'var(--color-node-ui)' }}
              >
                UI
              </span>
            </div>
            <div className="node__body">
              <span className="port">
                <span className="port__name">emit</span>
                <span className="port__type">onSubmit</span>
              </span>
              <span className="port">
                <span className="port__name">bound</span>
                <span className="port__type">useLogin</span>
              </span>
            </div>
          </div>

          <svg className="lineage__link rv" style={delay(3)} viewBox="0 0 84 60" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <path
              className="wire"
              style={delay(4)}
              pathLength="1"
              d="M0 30 C 34 30 50 30 84 30"
              stroke="var(--color-node-ui)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="code rv" style={delay(3)}>
            <div className="code__bar">
              <span>src/screens/LoginScreen.tsx</span>
              <span className="code__owner">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'var(--color-node-api)' }}
                  aria-hidden="true"
                />
                managed
              </span>
            </div>
            <pre className="code__body">
              {LINES.map((l) => (
                <div
                  key={l.no}
                  className={`code__line ${l.traced ? 'code__line--traced' : ''}`}
                >
                  <span className="code__no">{l.no}</span>
                  <span>{l.code}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] rv" style={delay(5)}>
          <div>
            <p className="note mb-4">
              <span className="note-rule" />
              What lands on disk
            </p>
            <div className="filetree">
              {TREE.map((file) => (
                <div className="filetree__row" key={file}>
                  {file}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="t-sub">Managed until you take it over.</h3>
            <p className="t-body text-ink-2 mt-2.5">
              Generated files stay managed: edit the node, the file follows. Eject one and it
              becomes yours, edited by hand, never overwritten. The Code node is the same bargain at
              a smaller scale, typed ports around TypeScript you wrote yourself.
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}
