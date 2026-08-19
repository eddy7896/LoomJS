import type { ComponentEmitter } from '../types';
import { frameEmitter } from './frame';
import { textEmitter } from './textComponent';

/**
 * The component template registry: each component type owns exactly one code template
 * (docs/02 — "compile = stitch templates + wire data flow"). Growing the vocabulary means
 * adding an emitter here, never branching inside the walker.
 */
const EMITTERS: ComponentEmitter[] = [frameEmitter, textEmitter];

const BY_TYPE = new Map(EMITTERS.map((e) => [e.type, e]));

export function emitterFor(type: string): ComponentEmitter | undefined {
  return BY_TYPE.get(type);
}

export function knownComponentTypes(): string[] {
  return [...BY_TYPE.keys()].sort();
}
