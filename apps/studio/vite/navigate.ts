/**
 * Sending the previewed app to the screen being designed (`docs/12-canvas.md`).
 *
 * The Preview always loaded the app's root, which is the **entry** artboard and only ever that
 * one. Everything else the compiler emits sits at its own route, so a designer adding elements to
 * a second screen watched a preview of a different screen and saw nothing appear — the elements
 * were compiled, delivered, and rendered on a page nobody was looking at.
 *
 * The frame is *told* where to go rather than reloaded there: a reload throws away whatever has
 * been typed into the running app, and there is no reason to pay that for a change of screen.
 *
 * This is injected by the preview dev server, so it exists only while a preview is being watched.
 * Nothing here is emitted into the project — the repo a user downloads has no idea loom exists.
 */
export const NAVIGATE_HOOK = `<script>
(() => {
  // Only inside the studio's frame. A page opened on its own has no parent to take orders from.
  if (window.parent === window) return;

  addEventListener('message', (event) => {
    // The embedder, and nothing else. Any other frame or window posting here is ignored, so a
    // page the app opens cannot steer it.
    if (event.source !== window.parent) return;

    const data = event.data;
    if (!data || data.source !== 'loom' || data.type !== 'navigate') return;

    // A path, and only a path: one leading slash, no scheme, no host. A protocol-relative "//host"
    // would be a cross-origin navigation wearing a path's clothes.
    const path = data.path;
    if (typeof path !== 'string') return;
    if (!/^[/][A-Za-z0-9._~%:@!$&'()*+,;=-]*(?:[/][A-Za-z0-9._~%:@!$&'()*+,;=-]+)*[/]?$/.test(path)) return;
    if (path.slice(0, 2) === '//') return;
    if (location.pathname === path) return;

    // pushState is silent by design, so the router is told separately. BrowserRouter listens for
    // popstate and re-renders from location — which is exactly what a click on a link would do.
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  });
})();
</script>`;
