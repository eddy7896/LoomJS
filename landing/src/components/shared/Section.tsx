import type { ReactNode } from 'react'
import { useInView } from '../../hooks/useInView'

/**
 * Every section is its own reveal scope. Children marked `.rv` release together
 * when the section enters view; `--rv-delay` staggers them.
 */
export function Section({
  id,
  className = '',
  children,
}: {
  id?: string
  className?: string
  children: ReactNode
}) {
  const { ref, inView } = useInView<HTMLElement>()

  return (
    <section id={id} ref={ref} className={`${className} ${inView ? 'is-in' : ''}`}>
      {children}
    </section>
  )
}
