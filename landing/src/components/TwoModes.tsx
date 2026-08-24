import { Section } from './shared/Section'
import { delay } from './shared/stagger'

const UI_HUE = 'var(--color-node-ui)'
const FN_HUE = 'var(--color-node-fn)'

function FrameGlyph() {
  return (
    <svg className="seam__glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6h11M6 2.5v11" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

const PALETTE: [string, string][] = [
  ['Frame', 'M2.5 2.5h11v11h-11z'],
  ['Text', 'M3 3.5h10M8 3.5v9'],
  ['Input', 'M2 5.5h12v5H2zM4.5 8h3'],
  ['Button', 'M2.5 5h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
]

function GraphGlyph() {
  return (
    <svg className="seam__glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="5" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="10" width="5" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 4h2.5a2 2 0 0 1 2 2v4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export function TwoModes() {
  return (
    <Section id="modes" className="section">
      <div className="shell">
        <div className="section__head section__head--split">
          <h2 className="t-section rv">
            One canvas.
            <br />
            Two modes.
          </h2>
          <div className="rv" style={delay(1)}>
            <p className="t-body text-ink-2">
              Design mode is the frontend: artboards, real components, flow arrows between screens.
              Nodes mode is the backend graph. Place a component and it gets a mirror node, so the
              thing you drew and the logic behind it are never out of sync.
            </p>
            <p className="note mt-5">
              The artboard owns appearance. The graph owns behaviour. Neither leaks into the other.
            </p>
          </div>
        </div>

        <div className="seam rv" style={delay(2)}>
          {/* The mirror, drawn only in the gutter, so both ends meet real edges. */}
          <div className="seam__mirror">
            <span>mirror</span>
            <svg viewBox="0 0 120 20" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path
                className="wire"
                style={delay(5)}
                pathLength="1"
                d="M4 10 H 116"
                stroke={UI_HUE}
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx="4" cy="10" r="3.5" fill="var(--color-panel)" stroke={UI_HUE} strokeWidth="2" />
              <circle cx="116" cy="10" r="3.5" fill="var(--color-canvas)" stroke={UI_HUE} strokeWidth="2" />
            </svg>
          </div>

          {/* ── Design mode ── */}
          <div className="seam__pane seam__pane--design">
            <p className="seam__label">
              <FrameGlyph />
              Design mode · frontend only
            </p>

            <div className="seam__stage">
              <div className="palette" aria-hidden="true">
                <div className="palette__title">Palette</div>
                {PALETTE.map(([name, d]) => (
                  <div className="palette__item" key={name}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                      <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {name}
                  </div>
                ))}
              </div>

              <div className="sheet w-[186px] p-4 flex flex-col gap-2.5">
                <div className="text-[12.5px] font-extrabold tracking-[-0.015em]">Welcome back</div>
                <div className="ab-field !py-2 !text-[11px]">email@fintrack.app</div>
                <div className="ab-field !py-2 !text-[11px]">••••••••</div>
                <div className="ab-btn !py-2 !text-[11.5px]">Sign in</div>
                <div className="font-mono text-[10px] text-ink-2">Artboard · Login</div>
              </div>
            </div>

            <div className="seam__lower">
              <p className="note mb-4">Flow arrows, not code, decide where a screen goes next.</p>
              <div className="flowpair">
                <div className="miniboard w-[104px]">
                  <div className="miniboard__name">Login</div>
                  <div className="miniboard__row">
                    <span>email</span>
                  </div>
                  <div className="miniboard__row">
                    <span>submit</span>
                  </div>
                </div>

                <svg width="56" height="18" viewBox="0 0 56 18" fill="none" aria-hidden="true">
                  <path
                    className="wire"
                    style={delay(6)}
                    pathLength="1"
                    d="M0 9h44"
                    stroke="var(--color-ink-2)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M40 4.5 46 9l-6 4.5"
                    stroke="var(--color-ink-2)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>

                <div className="miniboard w-[132px]">
                  <div className="miniboard__name">Dashboard</div>
                  <div className="miniboard__row">
                    <span>Groceries</span>
                    <span>42.10</span>
                  </div>
                  <div className="miniboard__row">
                    <span>Transit</span>
                    <span>18.60</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="note seam__note">
              A flow arrow between artboards compiles to a route and its guard.
            </p>
          </div>

          {/* ── Nodes mode ── */}
          <div className="seam__pane seam__pane--nodes">
            <p className="seam__label">
              <GraphGlyph />
              Nodes mode · the backend graph
            </p>

            <div className="seam__stage">
              <div className="node nodecol w-full">
                <div className="node__head">
                  <span className="pin" aria-hidden="true" />
                  <span className="node__title">LoginScreen</span>
                  <span
                    className="node__kind"
                    style={{ background: 'var(--color-node-ui-fill)', color: UI_HUE }}
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
                    <span className="port__name">email</span>
                    <span className="port__type">string</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="seam__lower">
              <p className="note mb-4">The grammar, in full.</p>

              <dl className="grammar">
                <div className="grammar__row">
                  <dt>
                    <span className="pin" aria-hidden="true" />
                    port
                  </dt>
                  <dd>A typed socket. Inputs on the left, outputs on the right.</dd>
                </div>

                <div className="grammar__row">
                  <dt>
                    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden="true">
                      <path
                        d="M1 5h20"
                        stroke={FN_HUE}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    wire
                  </dt>
                  <dd>Carries a value from one node&rsquo;s output into another&rsquo;s input.</dd>
                </div>

                <div className="grammar__row">
                  <dt>
                    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden="true">
                      <path
                        d="M1 5h20"
                        stroke="var(--color-ink-2)"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                        strokeLinecap="round"
                      />
                    </svg>
                    flow
                  </dt>
                  <dd>Navigation between artboards. Never the same thing as a wire.</dd>
                </div>
              </dl>
            </div>

            <p className="note seam__note">
              A wire takes the colour of the port it leaves, so the graph types itself.
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}
