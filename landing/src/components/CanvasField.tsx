/**
 * The page's ground: one continuous drafting table behind every section.
 * The grid drifts with the pointer and the paper lifts where the cursor sits.
 * Both layers move by transform only, so the whole effect is a composite.
 */
export function CanvasField() {
  return (
    <div className="canvas-field" aria-hidden="true">
      <div className="canvas-field__grid" />
      <div className="canvas-field__light" />
    </div>
  )
}
