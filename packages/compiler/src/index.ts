// Browser-safe entry: emission only, no node:fs. Disk writing lives in `@loom/compiler/node`
// so the studio can import the compiler (and its layout emission) into the canvas.
export * from './types';
export * from './compile';
export {
  buildFailureOf,
  diagnose,
  type BuildFailure,
  type DiagnoseOptions,
  type Problem,
  type ProblemSeverity,
} from './diagnostics';
export { knownComponentTypes } from './templates/registry';
export { layoutToStyle } from './emit/layout';
export { planRoutes, kebabCase, type RouteInfo, type RouteMap } from './emit/routes';
export { componentStyle, styleToCss } from './emit/style';
