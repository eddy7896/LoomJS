/** Stagger helper: `style={delay(2)}` puts an element two beats behind the first. */
export function delay(step: number) {
  return { '--rv-delay': `${step * 90}ms` } as React.CSSProperties
}
