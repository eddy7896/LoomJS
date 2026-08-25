import { CompileError, type ComponentEmitter } from '../types';
import { valueExpr } from '../emit/props';
import { indent } from '../emit/text';

/**
 * A reusable component, placed (R1, `docs/V1-COMPLETION.md`).
 *
 * It emits what a developer would have written: `<Header title="Invoices" />`. Not a lookup, not a
 * registry, not a `<Instance def="…" />` indirection — the definition became a real React
 * component with a real name, and this is a call to it.
 *
 * Its params emit as props, in the order the definition declares them, so a diff of the emitted
 * repo reads the way the definition does.
 */
export const instanceEmitter: ComponentEmitter = {
  type: 'Instance',
  emit(component, ctx, depth) {
    const chosen = component.props.defId;
    const defId = chosen?.kind === 'static' ? String(chosen.value ?? '') : '';
    const definition = ctx.snapshot.definitions?.[defId];

    if (!definition) {
      throw new CompileError(
        `This component does not point at a definition, so there is nothing to render. Choose ` +
          `one, or delete it.`,
        component.id,
      );
    }

    const name = ctx.requireDefinition(defId, component.id);

    /**
     * Only the params the definition declares. An override naming something it does not have is
     * dropped rather than emitted: it would be a prop the component's own signature refuses, and
     * the build error would point at generated code instead of at the decision that caused it.
     */
    const props = (definition.params ?? [])
      .map((param) => {
        const value = component.props[param.name];
        if (!value) return undefined;
        return `${param.name}={${valueExpr(value, ctx, component.id, param.name)}}`;
      })
      .filter((entry): entry is string => entry !== undefined);

    if (props.length === 0) return `${indent(depth)}<${name} />`;

    return `${indent(depth)}<${name}\n${props
      .map((prop) => `${indent(depth + 1)}${prop}`)
      .join('\n')}\n${indent(depth)}/>`;
  },
};
