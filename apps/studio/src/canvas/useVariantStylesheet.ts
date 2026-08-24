import { useEffect } from 'react';
import { componentsCss } from '@loom/ui';

/**
 * The variant stylesheet, in the studio (`docs/27-variants.md`).
 *
 * The emitted project gets these bytes as `src/components.css`. The canvas gets *the same string*
 * here — not a copy meaning to say the same thing, which is the arrangement that eventually stops
 * being true. A canvas that disagrees with the running app is a canvas nobody can design in, and
 * that complaint is exactly why the tokens were already shared this way.
 *
 * Injected into `<head>` rather than scoped to the canvas: the Nodes mirror, the inspector's
 * previews and anything else that draws a real element should be painted by it too. Every rule is
 * namespaced `loom-`, so nothing in the studio's own interface can be reached by it.
 */
const ELEMENT_ID = 'loom-variants';

export function useVariantStylesheet(): void {
  useEffect(() => {
    // One tag for the whole studio, however many components ask for it.
    if (document.getElementById(ELEMENT_ID)) return;

    const style = document.createElement('style');
    style.id = ELEMENT_ID;
    style.textContent = componentsCss();
    // First in the head, so the studio's own stylesheet — and any inline style a component
    // carries — still wins. Variants are the floor, never the ceiling.
    document.head.prepend(style);
  }, []);
}
