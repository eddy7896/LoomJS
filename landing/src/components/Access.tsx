import { useState } from 'react'
import { Section } from './shared/Section'
import { delay } from './shared/stagger'

export function Access() {
  const [sent, setSent] = useState(false)

  // TODO: point this at the real waitlist endpoint. Until then the form only
  // acknowledges locally; nothing is stored or transmitted.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSent(true)
  }

  return (
    <Section id="access" className="section">
      <div className="shell">
        <p className="note rv">
          <span className="note-rule" />
          Closed beta
        </p>

        <h2 className="t-section rv mt-5 max-w-[18ch]" style={delay(1)}>
          Build apps the way you design them.
        </h2>

        <p className="t-lead rv mt-6 text-ink-2" style={delay(2)}>
          loomJS is heading into a closed beta for designers who want to ship real full-stack apps
          and keep the code afterwards.
        </p>

        {sent ? (
          <p className="t-body mt-9 rv" style={delay(3)} role="status">
            Noted. We&rsquo;ll be in touch when invites go out.
          </p>
        ) : (
          <form className="access__form mt-9 rv" style={delay(3)} onSubmit={onSubmit}>
            <div>
              <label className="sr-only" htmlFor="access-email">
                Email address
              </label>
              <input
                className="field"
                id="access-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@studio.com"
              />
            </div>

            <div>
              <label className="sr-only" htmlFor="access-invite">
                Invite code, optional
              </label>
              <input
                className="field"
                id="access-invite"
                name="invite"
                type="text"
                placeholder="Invite code"
              />
            </div>

            <button className="btn-primary justify-center" type="submit">
              Request access
            </button>
          </form>
        )}

        <p className="note mt-5 rv" style={delay(4)}>
          Invite codes go out in batches. No newsletter, no drip sequence.
        </p>
      </div>
    </Section>
  )
}
