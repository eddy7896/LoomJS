import { useEffect } from 'react'

/**
 * Publishes the pointer to the document as CSS custom properties, so the canvas
 * ground can react to it without React re-rendering anything:
 *
 *   --mx / --my   pointer position in px, viewport coordinates
 *   --px / --py   pointer offset from centre, normalised to -1..1
 *
 * Values are eased toward the pointer inside a single rAF loop, and the loop
 * parks itself once it has settled. Every consumer moves via `transform`, so
 * this only ever costs a composite.
 *
 * Skipped entirely for reduced-motion users and for coarse pointers (touch),
 * where the defaults in CSS leave a static, centred light.
 */
export function usePointerField() {
  useEffect(() => {
    const root = document.documentElement

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!fine.matches || still.matches) return

    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight * 0.38
    let x = targetX
    let y = targetY
    let frame = 0

    const write = () => {
      root.style.setProperty('--mx', `${x.toFixed(1)}px`)
      root.style.setProperty('--my', `${y.toFixed(1)}px`)
      root.style.setProperty('--px', (x / window.innerWidth - 0.5).toFixed(4))
      root.style.setProperty('--py', (y / window.innerHeight - 0.5).toFixed(4))
    }

    const tick = () => {
      // Ease out, matching the page's one easing curve in feel.
      x += (targetX - x) * 0.085
      y += (targetY - y) * 0.085
      write()

      if (Math.abs(targetX - x) < 0.4 && Math.abs(targetY - y) < 0.4) {
        frame = 0
        return
      }
      frame = requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      targetX = event.clientX
      targetY = event.clientY
      if (!frame) frame = requestAnimationFrame(tick)
    }

    write()
    window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
