import type { ComponentEmitter } from '../types';
import { indent } from '../emit/text';
import { staticString } from '../emit/props';
import { styleAttr } from '../emit/style';
import { layoutSizeStyle } from '../emit/layout';
import { classAttr } from '../emit/variants';

/**
 * The upload fields (`docs/29-storage.md`).
 *
 * An ordinary input in every way that matters: its state is the stored key, which is text, so it
 * flows into a column or a pipeline exactly like a text field's value.
 *
 * What is different is that it can **fail on its own**. A text field cannot; an upload can be
 * refused for its type, refused for its size, or crawl up a hotel connection for forty seconds. So
 * each one carries its own status, and says which of those happened — a field that silently does
 * nothing is a field people press twice.
 */

/**
 * An upload field with no bucket yet.
 *
 * It renders, disabled, saying so — the same answer a List with no row template gives. Refusing the
 * whole build was the first attempt and it was wrong: dragging an element out of the palette would
 * have broken the running app until the designer went and attached a bucket, which is the tool
 * getting in the way of the order people actually work in.
 *
 * Nothing is guessed, either. Picking a bucket on someone's behalf would put a customer's documents
 * somewhere nobody decided on. Problems says what is missing, and the field says it too.
 */
function unconfigured(
  component: Parameters<ComponentEmitter['emit']>[0],
  ctx: Parameters<ComponentEmitter['emit']>[1],
  depth: number,
): string {
  const label = staticString(component, 'label', 'Choose a file');
  return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${indent(depth + 1)}<span className="loom-upload__pick" aria-disabled="true">{${JSON.stringify(label)}}</span>
${indent(depth + 1)}<span className="loom-upload__problem">{"Uploads are not set up yet."}</span>
${indent(depth)}</div>`;
}

/**
 * The shared body: a hidden file input, a label that opens it, and a line saying where it got to.
 *
 * `busy` is a separate state from the value on purpose. Reusing the value ("uploading…") would put
 * a sentence into a database column the first time somebody saved while it was still going.
 */
function uploadBody(
  component: Parameters<ComponentEmitter['emit']>[0],
  ctx: Parameters<ComponentEmitter['emit']>[1],
  depth: number,
  options: { preview: boolean },
): string {
  const bucket = staticString(component, 'bucket').trim();
  const label = staticString(component, 'label', 'Choose a file');
  const accept = staticString(component, 'accept');

  const state = ctx.requireFieldState(component.id, staticString(component, 'value'));
  // Busy and the problem are their own state: reusing the value would put "uploading…" into a
  // database column the first time somebody saved while it was still going.
  const status = ctx.requireState(`status_${state}`, { busy: false, problem: '' });
  const inputId = `input_${state}`;

  ctx.requireUpload();

  const acceptAttr = accept ? `\n${indent(depth + 2)}accept={${JSON.stringify(accept)}}` : '';

  /**
   * What was uploaded, once something has been.
   *
   * An image shows itself; a document says its name. Either way the value is *read* somewhere,
   * so a person can tell the upload finished — a field that swallows a file and looks unchanged
   * is one people upload to twice. The emitted app’s own build found this, by way of a state
   * nothing read.
   */
  const preview = options.preview
    ? `\n${indent(depth + 1)}{${state} ? (
${indent(depth + 2)}<img className="loom-upload__preview" src={${state}} alt="" />
${indent(depth + 1)}) : null}`
    : `\n${indent(depth + 1)}{${state} ? (
${indent(depth + 2)}<span className="loom-upload__stored">{String(${state}).split("/").pop()}</span>
${indent(depth + 1)}) : null}`;

  return `${indent(depth + 1)}<label className="loom-upload__pick" htmlFor={${JSON.stringify(inputId)}}>
${indent(depth + 2)}{${status}.busy ? "Uploading…" : ${JSON.stringify(label)}}
${indent(depth + 1)}</label>
${indent(depth + 1)}<input
${indent(depth + 2)}id={${JSON.stringify(inputId)}}
${indent(depth + 2)}className="loom-upload__input"
${indent(depth + 2)}type="file"${acceptAttr}
${indent(depth + 2)}disabled={${status}.busy}
${indent(depth + 2)}onChange={(event) => {
${indent(depth + 3)}const file = event.target.files?.[0];
${indent(depth + 3)}if (!file) return;
${indent(depth + 3)}set_${status}({ busy: true, problem: "" });
${indent(depth + 3)}uploadFile(${JSON.stringify(bucket)}, file).then(
${indent(depth + 4)}(stored) => {
${indent(depth + 5)}set_${state}(stored.url || stored.key);
${indent(depth + 5)}set_${status}({ busy: false, problem: "" });
${indent(depth + 4)}},
${indent(depth + 4)}(error: unknown) => {
${indent(depth + 5)}// What went wrong, in the words the server used — "larger than 10 MB" is something
${indent(depth + 5)}// a person can act on, and "upload failed" is not.
${indent(depth + 5)}set_${status}({ busy: false, problem: error instanceof Error ? error.message : "The upload did not finish." });
${indent(depth + 4)}},
${indent(depth + 3)});
${indent(depth + 2)}}}
${indent(depth + 1)}/>${preview}
${indent(depth + 1)}{${status}.problem ? (
${indent(depth + 2)}<span className="loom-upload__problem" role="alert">{${status}.problem}</span>
${indent(depth + 1)}) : null}`;
}

export const fileFieldEmitter: ComponentEmitter = {
  type: 'FileField',
  emit(component, ctx, depth) {
    if (!staticString(component, 'bucket').trim()) return unconfigured(component, ctx, depth);
    const body = uploadBody(component, ctx, depth, { preview: false });
    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${body}
${indent(depth)}</div>`;
  },
};

export const imageFieldEmitter: ComponentEmitter = {
  type: 'ImageField',
  emit(component, ctx, depth) {
    if (!staticString(component, 'bucket').trim()) return unconfigured(component, ctx, depth);
    const body = uploadBody(component, ctx, depth, { preview: true });
    return `${indent(depth)}<div${classAttr(component)}${styleAttr(component, ctx, layoutSizeStyle(component.layout))}>
${body}
${indent(depth)}</div>`;
  },
};
