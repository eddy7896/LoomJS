import { useState } from 'react'
import {
  INITIAL,
  LAYERS,
  LAYER_PROPS,
  NODES,
  NODE_PORTS,
  emit,
  type LayerId,
  type Mode,
  type NodeId,
} from './demoModel'

const MIN_RADIUS = 0
const MAX_RADIUS = 24

export function StudioDemo() {
  const [mode, setMode] = useState<Mode>('design')
  const [layer, setLayer] = useState<LayerId>('login')
  const [node, setNode] = useState<NodeId>('ui')
  const [state, setState] = useState(INITIAL)
  const [compiled, setCompiled] = useState(false)

  const selection = mode === 'design' ? layer : node
  const radius = state.radius[layer]

  const nudge = (by: number) =>
    setState((prev) => ({
      ...prev,
      radius: {
        ...prev.radius,
        [layer]: Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, prev.radius[layer] + by)),
      },
    }))

  const ring = (id: LayerId) =>
    mode === 'design' && layer === id && id !== 'login' ? ' sel-ring' : ''

  return (
    <>
      <div className="studio">
        <div className="studio__bar">
          <svg width="15" height="15" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="45" height="45" rx="11" stroke="var(--color-ink)" strokeWidth="3" />
            <path d="M13 13V35M23 13V35M33 13V35" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
            <path d="M13 19C23 19 23 29 33 29" stroke="var(--color-brand)" strokeWidth="3.5" strokeLinecap="round" />
          </svg>
          <span className="studio__name">fintrack</span>

          <div className="studio__modes">
            <button
              type="button"
              className="studio__mode"
              aria-pressed={mode === 'design'}
              onClick={() => setMode('design')}
            >
              Design
            </button>
            <button
              type="button"
              className="studio__mode"
              aria-pressed={mode === 'nodes'}
              onClick={() => setMode('nodes')}
            >
              Nodes
            </button>
          </div>

          <div className="studio__acts">
            <button
              type="button"
              className="studio__btn studio__btn--go"
              aria-pressed={compiled}
              onClick={() => setCompiled((on) => !on)}
            >
              {compiled ? 'Back to canvas' : 'Compile'}
            </button>
          </div>
        </div>

        <div className="studio__body">
          {/* ── Left rail: layers in Design, nodes in Nodes ── */}
          <div className="studio__rail">
            <p className="studio__railtitle">{mode === 'design' ? 'Layers' : 'Nodes'}</p>

            {mode === 'design'
              ? LAYERS.map((item) => (
                  <button
                    type="button"
                    className="studio__row"
                    key={item.id}
                    aria-pressed={layer === item.id}
                    onClick={() => setLayer(item.id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect
                        x="2.5"
                        y={item.kind === 'Frame' ? 2.5 : 5}
                        width="11"
                        height={item.kind === 'Frame' ? 11 : 6}
                        rx="1.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                    </svg>
                    {item.name}
                  </button>
                ))
              : NODES.map((item) => (
                  <button
                    type="button"
                    className="studio__row"
                    key={item.id}
                    aria-pressed={node === item.id}
                    onClick={() => setNode(item.id)}
                  >
                    <span className="dot" style={{ background: item.hue }} aria-hidden="true" />
                    {item.kind}
                  </button>
                ))}
          </div>

          {/* ── Stage ── */}
          <div className="studio__stage">
            <div className="studio__frame">
              <div className="studio__scene">
              {compiled ? (
                <div className="studio__code">
                  <div className="studio__codebar">
                    <span>src/screens/LoginScreen.tsx</span>
                  </div>
                  <pre className="studio__codebody">
                    {emit(state).map((line) => {
                      const traced = line.traces?.includes(selection as LayerId & NodeId)
                      return (
                        <div
                          className={`studio__codeline ${traced ? 'is-traced' : ''}`}
                          key={line.no}
                        >
                          <span className="n">{line.no}</span>
                          <span>{line.text}</span>
                        </div>
                      )
                    })}
                  </pre>
                </div>
              ) : mode === 'design' ? (
                <>
                  <svg className="studio__wire" viewBox="0 0 520 340" fill="none" aria-hidden="true">
                    <path
                      className="wire is-in"
                      d="M92 200 C 92 234 196 244 252 244"
                      stroke="var(--color-node-ui)"
                      strokeWidth="2.5"
                      pathLength="1"
                    />
                    <circle cx="92" cy="200" r="3.5" fill="var(--color-panel)" stroke="var(--color-node-ui)" strokeWidth="2" />
                    <circle cx="252" cy="244" r="3.5" fill="var(--color-panel)" stroke="var(--color-node-ui)" strokeWidth="2" />
                  </svg>

                  <div
                    className="studio__board"
                    style={{ borderRadius: state.radius.login }}
                    data-frame={layer === 'login' || undefined}
                  >
                    <span className="studio__label">Artboard · Login</span>
                    <div className="text-[14px] font-extrabold tracking-[-0.015em]">Welcome back</div>
                    <div
                      className={`mini-field${ring('email')}`}
                      style={{ borderRadius: state.radius.email }}
                    >
                      email@fintrack.app
                    </div>
                    <div
                      className={`mini-field${ring('password')}`}
                      style={{ borderRadius: state.radius.password }}
                    >
                      ••••••••
                    </div>
                    <div
                      className={`mini-btn${ring('submit')}`}
                      style={{ borderRadius: state.radius.submit }}
                    >
                      {state.label || 'Sign in'}
                    </div>

                    {layer === 'login' && (
                      <>
                        <span className="studio__handle" style={{ left: -8, top: -8 }} />
                        <span className="studio__handle" style={{ right: -8, top: -8 }} />
                        <span className="studio__handle" style={{ left: -8, bottom: -8 }} />
                        <span className="studio__handle" style={{ right: -8, bottom: -8 }} />
                      </>
                    )}
                  </div>

                  <div className="node studio__chip">
                    <div className="node__head">
                      <span className="pin" aria-hidden="true" />
                      <span className="node__title">LoginScreen</span>
                      <span
                        className="node__kind"
                        style={{
                          background: 'var(--color-node-ui-fill)',
                          color: 'var(--color-node-ui)',
                        }}
                      >
                        UI
                      </span>
                    </div>
                    <div className="node__body">
                      <span className="port">
                        <span className="port__name">emit</span>
                        <span className="port__type">onSubmit</span>
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <svg className="studio__wire" viewBox="0 0 520 340" fill="none" aria-hidden="true">
                    <path
                      className="wire is-in"
                      d="M34 73 C 34 112 108 146 150 146"
                      stroke="var(--color-node-ui)"
                      strokeWidth="2.5"
                      pathLength="1"
                    />
                    <path
                      className="wire is-in"
                      d="M186 201 C 186 240 206 276 240 276"
                      stroke="var(--color-node-fn)"
                      strokeWidth="2.5"
                      pathLength="1"
                    />
                  </svg>

                  {NODES.map((item, i) => (
                    <button
                      type="button"
                      key={item.id}
                      className="node studio__gnode"
                      aria-pressed={node === item.id}
                      onClick={() => setNode(item.id)}
                      style={{ left: [0, 150, 240][i], top: [0, 128, 258][i], width: [240, 230, 250][i] }}
                    >
                      <span className="node__head">
                        <span className="pin" style={{ borderColor: item.hue }} aria-hidden="true" />
                        <span className="node__title">{item.name}</span>
                        <span
                          className="node__kind"
                          style={{ background: item.fill, color: item.hue }}
                        >
                          {item.kind}
                        </span>
                      </span>
                      <span className="node__body">
                        <span className="port">
                          <span className="port__name">{NODE_PORTS[item.id][0][0]}</span>
                          <span className="port__type">{NODE_PORTS[item.id][0][1]}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </>
                )}
              </div>
            </div>
          </div>

          {/* ── Inspector ── */}
          <div className="studio__rail studio__rail--right">
            <p className="studio__railtitle">Inspector</p>

            {mode === 'design' ? (
              <>
                <div className="studio__prop">
                  <span>radius</span>
                  <span className="studio__stepper">
                    <button
                      type="button"
                      className="studio__step"
                      onClick={() => nudge(-1)}
                      disabled={radius <= MIN_RADIUS}
                      aria-label={`Decrease radius, currently ${radius}`}
                    >
                      −
                    </button>
                    <span className="studio__num" aria-live="polite">
                      {radius}
                    </span>
                    <button
                      type="button"
                      className="studio__step"
                      onClick={() => nudge(1)}
                      disabled={radius >= MAX_RADIUS}
                      aria-label={`Increase radius, currently ${radius}`}
                    >
                      +
                    </button>
                  </span>
                </div>

                {LAYER_PROPS[layer].map(([key, value]) => (
                  <div className="studio__prop" key={key}>
                    <span>{key}</span>
                    <b>{value}</b>
                  </div>
                ))}

                {layer === 'submit' && (
                  <div className="studio__prop studio__prop--stack">
                    <label htmlFor="demo-label">label</label>
                    <input
                      id="demo-label"
                      className="studio__input"
                      value={state.label}
                      maxLength={18}
                      onChange={(event) =>
                        setState((prev) => ({ ...prev, label: event.target.value }))
                      }
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                {NODE_PORTS[node].map(([key, value]) => (
                  <div className="studio__prop" key={key}>
                    <span>{key}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <p className="studio__hint">
        Live demo. Pick a layer, change its radius, then Compile.
      </p>
    </>
  )
}
