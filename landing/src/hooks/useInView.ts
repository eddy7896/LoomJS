import { useEffect, useRef, useState } from 'react'

/**
 * Adds `is-in` to the element once it enters the viewport, which releases every
 * `.rv` reveal and every `.wire` draw inside it. One observer per section keeps
 * the whole page's motion on a single orchestration rather than scattering
 * micro-interactions. Fires once; `prefers-reduced-motion` is handled in CSS.
 */
export function useInView<T extends HTMLElement>(rootMargin = '-12% 0px -10% 0px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            io.disconnect()
          }
        }
      },
      { rootMargin, threshold: 0.05 },
    )

    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])

  return { ref, inView }
}
