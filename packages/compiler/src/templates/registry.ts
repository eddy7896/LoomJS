import type { ComponentEmitter } from '../types';
import { buttonEmitter } from './button';
import { frameEmitter } from './frame';
import { listEmitter } from './list';
import { tableEmitter } from './table';
import { textEmitter } from './textComponent';
import { textFieldEmitter } from './textField';
import { checkboxEmitter, numberFieldEmitter, selectEmitter } from './inputs';
import {
  dateFieldEmitter,
  multilineFieldEmitter,
  radioGroupEmitter,
  sliderEmitter,
} from './inputs2';
import { iconEmitter, imageEmitter, linkEmitter } from './media';
import { shapeEmitter } from './shape';

/**
 * The component template registry: each component type owns exactly one code template
 * (docs/02 — "compile = stitch templates + wire data flow"). Growing the vocabulary means
 * adding an emitter here, never branching inside the walker.
 */
const EMITTERS: ComponentEmitter[] = [
  frameEmitter,
  textEmitter,
  buttonEmitter,
  textFieldEmitter,
  numberFieldEmitter,
  checkboxEmitter,
  selectEmitter,
  listEmitter,
  tableEmitter,
  imageEmitter,
  linkEmitter,
  iconEmitter,
  multilineFieldEmitter,
  radioGroupEmitter,
  dateFieldEmitter,
  sliderEmitter,
  shapeEmitter,
];

const BY_TYPE = new Map(EMITTERS.map((e) => [e.type, e]));

export function emitterFor(type: string): ComponentEmitter | undefined {
  return BY_TYPE.get(type);
}

export function knownComponentTypes(): string[] {
  return [...BY_TYPE.keys()].sort();
}
