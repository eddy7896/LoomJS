import { actionsOf, type Component, type Id, type Node, type PortRef, type Snapshot } from '@loom/ir';
import { isVariable, nodeTitle } from '@loom/components';
import { isBucket } from '@loom/connectors';
import { usesAuth } from './emit/auth';
import { compile } from './compile';
import { CompileError } from './types';

/**
 * Problems — the first of the three error tiers (`docs/specs/problems.md`).
 *
 * Two things stop the compiler being the only source of truth here. It **stops at the first
 * failure**, because its job is to refuse a build rather than survey one; and emission is
 * **demand-driven**, so a half-wired node nothing reads is not compiled at all — which is correct
 * for the build and useless for the person still wiring it.
 *
 * So this walks the document instead, finding every instance of each fault whether or not the
 * compiler would ever reach it, and deliberately reuses the compiler's own sentences: the panel
 * and the Build error must never disagree about the same mistake.
 *
 * **Nothing in this file throws.** It runs on every keystroke, over documents mid-edit, and a
 * crash here would take the editor down with it.
 */

export type ProblemSeverity = 'error' | 'warning';

/** What the compiler refused, when someone has already compiled and knows. */
export interface BuildFailure {
  message: string;
  entityId: Id | undefined;
}

export interface DiagnoseOptions {
  /**
   * The Build tier's answer, when the caller already has it: a failure, or `null` for a clean
   * compile. Omit it and this compiles for itself.
   *
   * The studio passes what the Preview has already worked out. Emission is not cheap, and running
   * it a second time on the render path — once per keystroke, for a row the Preview is holding
   * anyway — is a cost with nothing behind it.
   */
  build?: BuildFailure | null;
}

export interface Problem {
  /** Derived from the code and the entity, never from position — a row keeps its identity. */
  id: string;
  severity: ProblemSeverity;
  code: string;
  /** The sentence a designer reads. */
  message: string;
  entityId: Id | undefined;
  entityKind: 'component' | 'node' | 'artboard' | undefined;
  /** The screen to switch to before selecting the entity. */
  artboardId: Id | undefined;
}

const label = (node: Node): string => nodeTitle(node);
const componentLabel = (component: Component): string => component.name ?? component.type;

/** Node ids sitting inside some API route's body — their operands are config, not wires. */
function insideRoutes(snapshot: Snapshot): Set<Id> {
  const inside = new Set<Id>();
  for (const node of Object.values(snapshot.nodes)) {
    if (node.category !== 'api') continue;
    for (const id of ((node.config ?? {}) as { body?: Id[] }).body ?? []) inside.add(id);
  }
  return inside;
}

/** Which artboard owns each component, so a row can switch screens before selecting. */
function artboardIndex(snapshot: Snapshot): Map<Id, Id> {
  const owner = new Map<Id, Id>();
  for (const artboard of Object.values(snapshot.artboards)) {
    const walk = (id: Id): void => {
      if (owner.has(id)) return;
      owner.set(id, artboard.id);
      for (const child of snapshot.components[id]?.children ?? []) walk(child);
    };
    walk(artboard.root);
  }
  return owner;
}

/** Compile, and report what was refused. Never throws — a refusal is the answer, not a failure. */
export function buildFailureOf(snapshot: Snapshot): BuildFailure | null {
  try {
    compile(snapshot);
    return null;
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      entityId: error instanceof CompileError ? error.entityId : undefined,
    };
  }
}

/** Whether a port reference points at something that still exists. */
function resolves(snapshot: Snapshot, ref: PortRef): boolean {
  const node = snapshot.nodes[ref.nodeId];
  return Boolean(node?.ports.some((port) => port.id === ref.portId));
}

export function diagnose(snapshot: Snapshot, options: DiagnoseOptions = {}): Problem[] {
  const problems: Problem[] = [];
  const inside = insideRoutes(snapshot);
  const owner = artboardIndex(snapshot);
  const wires = Object.values(snapshot.wires);

  const add = (
    code: string,
    severity: ProblemSeverity,
    message: string,
    entityId: Id | undefined,
    entityKind: Problem['entityKind'],
    suffix = '',
  ): void => {
    problems.push({
      id: `${code}:${entityId ?? '-'}${suffix}`,
      severity,
      code,
      message,
      entityId,
      entityKind,
      artboardId: entityKind === 'component' && entityId ? owner.get(entityId) : undefined,
    });
  };

  // ---- Uploads: a field has to know where the file goes (`docs/29-storage.md`) ----------

  const buckets = new Set(
    Object.values(snapshot.connectors)
      .filter((connector) => isBucket(connector.moduleId))
      .map((connector) => connector.id),
  );

  for (const component of Object.values(snapshot.components)) {
    if (component.type !== 'FileField' && component.type !== 'ImageField') continue;

    const chosen = component.props.bucket;
    const bucketId = chosen?.kind === 'static' ? String(chosen.value ?? '').trim() : '';

    if (!bucketId) {
      add(
        'upload-no-bucket',
        'error',
        `"${componentLabel(component)}" has nowhere to put a file. Attach a bucket under Files, ` +
          `then pick it here.`,
        component.id,
        'component',
      );
      continue;
    }

    // A bucket that was removed, or a project file opened where it never existed. The field would
    // fail on the first upload, and finding that out from a customer is the worst way to find out.
    if (!buckets.has(bucketId)) {
      add(
        'upload-missing-bucket',
        'error',
        `"${componentLabel(component)}" points at a bucket this project no longer has.`,
        component.id,
        'component',
      );
    }
  }

  // ---- Screens: who may open them (spec 10) -------------------------------

  for (const artboard of Object.values(snapshot.artboards)) {
    const guard = artboard.guard;
    if (!guard) continue;

    const destination = snapshot.artboards[guard.redirectTo];
    if (!destination) {
      add(
        'dangling-guard',
        'error',
        `"${artboard.name}" sends signed-out visitors to a screen that no longer exists.`,
        artboard.id,
        'artboard',
      );
      continue;
    }
    if (destination.guard) {
      add(
        'guard-loop',
        'error',
        `"${artboard.name}" sends signed-out visitors to "${destination.name}", which is also ` +
          `only for signed-in people. They would bounce between the two forever.`,
        artboard.id,
        'artboard',
      );
    }
  }

  // Signing in needs somewhere to sign in to. This is the compiler's sentence, said earlier.
  if (usesAuth(snapshot)) {
    const connected = Object.values(snapshot.connectors).some(
      (connector) => connector.moduleId === 'supabase',
    );
    if (!connected) {
      add(
        'auth-without-connection',
        'error',
        'This app signs people in, which needs a Supabase connection. Connect one in Data.',
        undefined,
        undefined,
      );
    }
  }

  // ---- Components: everything a property can point at ---------------------

  for (const component of Object.values(snapshot.components)) {
    const name = componentLabel(component);

    for (const [key, value] of Object.entries(component.props)) {
      if (value.kind === 'bound' && !resolves(snapshot, value.source)) {
        add(
          'dangling-binding',
          'error',
          `"${name}" reads something that no longer exists, so "${key}" has nothing to show.`,
          component.id,
          'component',
          `:${key}`,
        );
      }

      if (value.kind !== 'event') continue;

      // Every step, not just the first: a sequence can break at position three (spec 7).
      for (const [index, action] of actionsOf(value.handler).entries()) {
        if (action.kind === 'trigger' && !resolves(snapshot, action.target)) {
          add(
            'dangling-trigger',
            'error',
            `Step ${index + 1} of "${name}" fires something that no longer exists.`,
            component.id,
            'component',
            `:${key}:${index}`,
          );
        }

        if (action.kind === 'navigate' && !snapshot.flows[action.flowId]) {
          add(
            'dangling-flow',
            'error',
            `Step ${index + 1} of "${name}" navigates along an arrow that has been removed.`,
            component.id,
            'component',
            `:${key}:${index}`,
          );
        }

        if (action.kind === 'setField' || action.kind === 'clearField') {
          if (!snapshot.components[action.componentId]) {
            add(
              'dangling-action-target',
              'error',
              `Step ${index + 1} of "${name}" sets a field that no longer exists.`,
              component.id,
              'component',
              `:${key}:${index}`,
            );
          }
        }

        if (action.kind === 'setVariable' && !snapshot.nodes[action.nodeId]) {
          add(
            'dangling-action-target',
            'error',
            `Step ${index + 1} of "${name}" sets a variable that no longer exists.`,
            component.id,
            'component',
            `:${key}:${index}`,
          );
        }

        // An auth step with nothing to sign in with runs, fails, and says the details did not
        // match — which is true and useless. The empty box is the actual fault.
        if (action.kind === 'signIn' || action.kind === 'signUp') {
          const blank = (source: { kind: string; value?: unknown }): boolean =>
            source.kind === 'static' && String(source.value ?? '').trim() === '';
          if (blank(action.email) || blank(action.password)) {
            add(
              'auth-without-details',
              'warning',
              `Step ${index + 1} of "${name}" signs someone in without an email and a password ` +
                `wired to it, so it can only fail.`,
              component.id,
              'component',
              `:${key}:${index}`,
            );
          }
        }

        if (action.when && !resolves(snapshot, action.when.source)) {
          add(
            'dangling-condition',
            'error',
            `Step ${index + 1} of "${name}" is conditional on something that no longer exists.`,
            component.id,
            'component',
            `:${key}:${index}`,
          );
        }
      }
    }

    const conditions = [
      ...(component.visibleWhen ? [component.visibleWhen] : []),
      ...(component.conditionalStyles ?? []).map((entry) => entry.when),
    ];
    for (const [index, condition] of conditions.entries()) {
      if (resolves(snapshot, condition.source)) continue;
      add(
        'dangling-condition',
        'error',
        `A condition on "${name}" reads something that no longer exists, so it can never hold.`,
        component.id,
        'component',
        `:${index}`,
      );
    }
  }

  // No check for an arrow pointing at a deleted screen: `addFlow` refuses an unknown destination
  // and `removeArtboard` takes every flow touching it, so the IR already holds that invariant.
  // Re-checking it here would be a row that can never appear.

  // ---- Nodes --------------------------------------------------------------

  const wiredInto = (nodeId: Id, portId: Id): boolean =>
    wires.some((wire) => wire.to.nodeId === nodeId && wire.to.portId === portId);
  const wiredOutOf = (nodeId: Id, portId: Id): boolean =>
    wires.some((wire) => wire.from.nodeId === nodeId && wire.from.portId === portId);

  // What properties and conditions point at. A variable is usually read by a *binding* rather than
  // a wire, so a node with no wires at all can still be very much in use.
  const boundSomewhere = new Set<string>();
  const referenced = new Set<Id>();
  for (const component of Object.values(snapshot.components)) {
    for (const value of Object.values(component.props)) {
      if (value.kind === 'bound') {
        boundSomewhere.add(`${value.source.nodeId}:${value.source.portId}`);
        referenced.add(value.source.nodeId);
      }
      if (value.kind === 'event') {
        for (const action of actionsOf(value.handler)) {
          if (action.kind === 'trigger') referenced.add(action.target.nodeId);
          if (action.kind === 'setVariable') referenced.add(action.nodeId);
        }
      }
    }
    if (component.visibleWhen) referenced.add(component.visibleWhen.source.nodeId);
    for (const entry of component.conditionalStyles ?? []) referenced.add(entry.when.source.nodeId);
  }

  for (const node of Object.values(snapshot.nodes)) {
    if (node.category === 'ui') continue;

    const dataInputs = node.ports.filter((p) => p.direction === 'in' && p.portKind === 'data');
    const dataOutputs = node.ports.filter((p) => p.direction === 'out' && p.portKind === 'data');
    const touched =
      referenced.has(node.id) ||
      wires.some((wire) => wire.from.nodeId === node.id || wire.to.nodeId === node.id);

    // A node with no wires at all is not wrong yet — it is a node someone has just dropped.
    if (!touched) {
      add(
        'orphan-node',
        'warning',
        `"${label(node)}" is not wired to anything yet.`,
        node.id,
        'node',
      );
      continue;
    }

    // Inside a route body the operands are named fields of the request, chosen in the inspector,
    // so an unwired port there is not a fault (`docs/specs/binding-trigger-runtime.md`).
    if (node.category === 'fn' && !inside.has(node.id)) {
      for (const [index, port] of dataInputs.entries()) {
        if (wiredInto(node.id, port.id)) continue;
        const which = dataInputs.length > 1 ? `input ${index + 1} of ` : '';
        add(
          'unwired-input',
          'error',
          `${which}"${label(node)}" has nothing wired into it, so there is no value to derive.`,
          node.id,
          'node',
          `:${port.id}`,
        );
      }
    }

    if (isVariable(node)) {
      const writers = wires.filter(
        (wire) => wire.to.nodeId === node.id && wire.to.portId === 'pt_set',
      );

      if (writers.length === 0) {
        add(
          'variable-never-written',
          'error',
          `Nothing is wired into "${label(node)}", so it never holds anything. ` +
            `Wire a result into its set port.`,
          node.id,
          'node',
        );
      }

      for (const wire of writers) {
        const source = snapshot.nodes[wire.from.nodeId];
        if (!source || source.category !== 'fn') continue;
        if (wiredInto(source.id, 'pt_run')) continue;
        add(
          'reactive-writer',
          'error',
          `"${label(source)}" recomputes on its own, so it cannot decide when to set ` +
            `"${label(node)}". Wire a button into its run port, and the variable updates when ` +
            `that button is pressed.`,
          source.id,
          'node',
          `:${node.id}`,
        );
      }
    }

    // Nothing shows or keeps what it works out. Muted: this is what half-finished work looks
    // like, and shouting at it is worse than saying nothing (`docs/02`).
    const read = dataOutputs.some(
      (port) => wiredOutOf(node.id, port.id) || boundSomewhere.has(`${node.id}:${port.id}`),
    );
    if (dataOutputs.length > 0 && !read && !inside.has(node.id)) {
      add(
        'unread-result',
        'warning',
        `Nothing shows or keeps what "${label(node)}" works out.`,
        node.id,
        'node',
      );
    }
  }

  // ---- The Build tier -----------------------------------------------------

  // Added last, and only when no structural row already names the same entity: the same fault
  // reported twice reads as two faults.
  const named = new Set(problems.filter((p) => p.severity === 'error').map((p) => p.entityId));
  const failure = 'build' in options ? options.build : buildFailureOf(snapshot);

  if (failure && !named.has(failure.entityId)) {
    const { entityId } = failure;
    const component = entityId ? snapshot.components[entityId] : undefined;
    add(
      'build',
      'error',
      failure.message,
      entityId,
      entityId ? (component ? 'component' : 'node') : undefined,
    );
  }

  // Errors first, then by code, so the list has an order that does not depend on object insertion.
  return problems.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}
