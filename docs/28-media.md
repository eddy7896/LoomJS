# 28 — Media elements

The vocabulary could put a picture on a screen and nothing else. No video, no audio, no gallery —
so any project that needed one of those needed a developer, which is the thing loom exists to avoid.

Six elements, in a **Media** section of the palette.

| Element | What it is | Why it is its own element |
| --- | --- | --- |
| **Video** | A `<video>` with the browser's controls | An `<img>` cannot play |
| **Audio** | An `<audio>` with the browser's controls | Same, and the shape on screen is different |
| **Carousel** | One picture at a time, with previous/next and dots | Needs state; a List cannot hold an index |
| **Tiles** | A responsive grid that wraps by *width*, not by count | Not expressible in the row/column layout |
| **Avatar** | A round picture that falls back to initials | The fallback is the whole point |
| **Embed** | An `<iframe>` for a map, a video host, a form | The only way to put someone else's page in yours |

## The rules they follow

- **No runtime, no library, no asset pipeline.** A `<video>` element is a video player. Shipping a
  player library to do what the browser already does would add a megabyte and take away the native
  controls people already know.
- **Autoplay is muted, always.** Every browser blocks sound that starts by itself, so an autoplaying
  video with sound is a video that silently does not start. Choosing autoplay therefore *sets*
  muted, rather than emitting a combination that cannot work.
- **A carousel is real state.** Its index is a `useState` in the emitted component, the same
  mechanism a List's paging uses — not a library, and not a CSS trick that breaks on keyboard.
- **Tiles wrap by width.** `repeat(auto-fill, minmax(<min>px, 1fr))` — the grid decides how many
  columns fit, so a gallery works on a phone and on a desktop without a second layout. That is the
  one thing the existing flex layout genuinely cannot say.
- **Alt text and titles are fields, not afterthoughts.** An Embed with no title is a frame a screen
  reader announces as "frame", which is why a blank one is refused at compile time rather than
  shipped.
- **Every media element has variants** (`docs/27-variants.md`), so it arrives looking like something
  rather than like a browser default.

## Embed and trust

An Embed puts **someone else's page** inside yours. That is what it is for, and it is worth being
plain about what it means:

- The embedded page cannot read your app — it is a separate origin, and the browser keeps it that
  way.
- It *is* live third-party code: it can run scripts, set its own cookies, and see that it was loaded.
- So `referrerPolicy="no-referrer"` is set — the embedded host is not told which page of your app
  the person is on — and `loading="lazy"`, so an embed below the fold costs nothing until it is
  reached.
- No `sandbox` by default, because the embeds people actually use (a video host, a map, a form)
  need scripts and their own origin to work at all, and a sandbox that has to be opened back up is
  a sandbox in name only. Embed sources you trust.

## What is deliberately not here

- **No custom video chrome.** A skinned player is a player that has to be maintained against six
  browsers forever, and the native one is better on a phone than anything hand-built.
- **No autoplaying carousel by default.** `Interval` is a field, and it starts at 0 — motion nobody
  asked for is motion some people cannot use.
- **No upload.** These elements point at a URL. Where files live and who may read them is a
  storage decision the project makes, not something an element on a screen should invent.
