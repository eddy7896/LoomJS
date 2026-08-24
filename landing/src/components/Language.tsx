import { Section } from './shared/Section'
import { delay } from './shared/stagger'

type Spec = {
  name: string
  kind: string
  hue: string
  fill: string
  ports: [string, string][]
}

const UI: Spec = {
  name: 'LoginScreen',
  kind: 'UI',
  hue: 'var(--color-node-ui)',
  fill: 'var(--color-node-ui-fill)',
  ports: [
    ['emit', 'onSubmit'],
    ['email', 'string'],
  ],
}

const FN: Spec = {
  name: 'validate',
  kind: 'FN',
  hue: 'var(--color-node-fn)',
  fill: 'var(--color-node-fn-fill)',
  ports: [
    ['rule', 'len ≥ 8'],
    ['out', 'boolean'],
  ],
}

const API: Spec = {
  name: 'POST /auth/login',
  kind: 'API',
  hue: 'var(--color-node-api)',
  fill: 'var(--color-node-api-fill)',
  ports: [
    ['body', 'Credentials'],
    ['200', '{ token }'],
  ],
}

const ST: Spec = {
  name: 'session',
  kind: 'STATE',
  hue: 'var(--color-node-st)',
  fill: 'var(--color-node-st-fill)',
  ports: [
    ['token', 'string'],
    ['user', 'User | null'],
  ],
}

const DB: Spec = {
  name: 'transactions',
  kind: 'DB',
  hue: 'var(--color-node-db)',
  fill: 'var(--color-node-db-fill)',
  ports: [
    ['id', 'uuid pk'],
    ['amount', 'decimal'],
  ],
}

const ALL = [UI, FN, API, ST, DB]

const LEGEND = [
  { hue: 'var(--color-node-ui)', name: 'UI', gloss: 'a component you placed on an artboard' },
  { hue: 'var(--color-node-fn)', name: 'FN', gloss: 'a function with typed in and out ports' },
  { hue: 'var(--color-node-api)', name: 'API', gloss: 'a route that runs on the server' },
  { hue: 'var(--color-node-st)', name: 'STATE', gloss: 'a value that survives a render' },
  { hue: 'var(--color-node-db)', name: 'DB', gloss: 'a real table, read from your schema' },
]

function NodeCard({ spec, step }: { spec: Spec; step: number }) {
  return (
    <div className="node node--deep rv" style={delay(step)}>
      <div className="node__head">
        <span
          className="w-2.5 h-2.5 rounded-[3px] shrink-0"
          style={{ background: spec.hue }}
          aria-hidden="true"
        />
        <span className="node__title">{spec.name}</span>
        <span className="node__kind" style={{ background: spec.fill, color: 'var(--color-deep)' }}>
          {spec.kind}
        </span>
      </div>
      <div className="node__body">
        {spec.ports.map(([name, type]) => (
          <span className="port" key={name}>
            <span className="port__name">{name}</span>
            <span className="port__type">{type}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** A wire in its own grid cell, so its ends always meet the nodes either side. */
function Link({ hue, step }: { hue: string; step: number }) {
  return (
    <svg
      className="pipe__link"
      viewBox="0 0 54 44"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="wire"
        style={delay(step)}
        pathLength="1"
        d="M0 22 C 18 22 36 22 54 22"
        stroke={hue}
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function Language() {
  return (
    <Section id="language" className="deep section">
      <div className="shell">
        <div className="section__head section__head--split">
          <div>
            <p className="note note--on-deep rv">
              <span className="note-rule note-rule--on-deep" />
              The visual language
            </p>
            <h2 className="t-section rv mt-5" style={delay(1)}>
              Five node types.
              <br />
              Colour is the type system.
            </h2>
          </div>
          <p className="t-lead rv" style={delay(2)}>
            Nodes are functions. Wires are data flow. A wire takes the colour of the port it leaves,
            so you read a graph by its hues before you read a single label. Every hue travels with
            its name, because colour that only works for some readers is not a type system.
          </p>
        </div>

        {/* Wide: the pipeline, wired end to end. */}
        <div className="pipe">
          <NodeCard spec={UI} step={3} />
          <Link hue={UI.hue} step={4} />
          <NodeCard spec={FN} step={4} />
          <Link hue={FN.hue} step={5} />
          <NodeCard spec={API} step={5} />
          <Link hue={API.hue} step={6} />
          <NodeCard spec={ST} step={6} />

          <svg
            className="pipe__drop"
            viewBox="0 0 220 46"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
          >
            <path
              className="wire"
              style={delay(7)}
              pathLength="1"
              d="M110 46 C 110 26 110 20 110 0"
              stroke={DB.hue}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="pipe__foot">
            <NodeCard spec={DB} step={7} />
          </div>
        </div>

        {/* Narrow: the same five nodes, tiled. The legend carries the meaning. */}
        <div className="specimen">
          {ALL.map((spec, i) => (
            <NodeCard spec={spec} step={3 + i} key={spec.kind} />
          ))}
        </div>

        <ul className="legend rv" style={delay(8)}>
          {LEGEND.map((l) => (
            <li className="legend__item" key={l.name}>
              <span className="legend__swatch" style={{ background: l.hue }} aria-hidden="true" />
              <span className="legend__name">{l.name}</span>
              <span>{l.gloss}</span>
            </li>
          ))}
        </ul>

        <p className="note note--on-deep mt-8 rv" style={delay(9)}>
          Anything the vocabulary cannot express honestly drops into a Code node: typed ports,
          hand-written TypeScript, no broken metaphor.
        </p>
      </div>
    </Section>
  )
}
