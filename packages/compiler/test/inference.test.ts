import { describe, expect, it } from 'vitest';
import { applyOps, type Snapshot } from '@loom/ir';
import { inferBackend } from '@loom/inference';
import { compile } from '../src/index';
import { formSnapshot, inferredSnapshot } from './fixtures';

/**
 * M5 from the compiler's side. The whole bet of "AUTO is provenance, not a mode" is that an
 * inferred document needs no special handling here — so these tests assert on the *emitted code*,
 * never on the marks.
 */

const fileNamed = (files: { path: string; content: string }[], path: string): string => {
  const found = files.find((file) => file.path === path);
  if (!found) throw new Error(`No emitted file "${path}". Got: ${files.map((f) => f.path).join(', ')}`);
  return found.content;
};

describe('an inferred pipeline compiles like any other', () => {
  it('emits one serverless function that validates then inserts', () => {
    const { snapshot } = inferredSnapshot();
    const api = fileNamed(compile(snapshot).files, 'api/createnotes.ts');

    // Validation runs on the server, where it cannot be bypassed.
    expect(api).toContain('title is required.');
    expect(api).toContain(`.from("notes").insert(row)`);
    // The required check must come before the insert, or the database reports the problem.
    expect(api.indexOf('title is required.')).toBeLessThan(api.indexOf('.insert(row)'));
  });

  it('leaves an optional column out rather than inserting an empty string', () => {
    const { snapshot } = inferredSnapshot();
    const api = fileNamed(compile(snapshot).files, 'api/createnotes.ts');
    expect(api).toContain('delete row["body"]');
    expect(api).not.toContain('body is required');
  });

  it('sends each form field as the column it fills', () => {
    const { snapshot } = inferredSnapshot();
    const home = fileNamed(compile(snapshot).files, 'src/artboards/Home.tsx');
    expect(home).toContain('"title": field_cp_title');
    expect(home).toContain('"body": field_cp_body');
    expect(home).toContain('"/api/createnotes"');
  });

  it('fires the pipeline from the button the designer drew', () => {
    const { snapshot } = inferredSnapshot();
    const home = fileNamed(compile(snapshot).files, 'src/artboards/Home.tsx');
    expect(home).toMatch(/onClick=\{\(\) => \{ void run_nd_\w+\(\); \}\}|onClick=\{\(\) => void run_nd_/);
  });

  it('writes the inserted row into screen state, and reads it back where it is bound', () => {
    const { snapshot, stateId } = inferredSnapshot();
    const home = fileNamed(compile(snapshot).files, 'src/artboards/Home.tsx');
    const name = `state_${stateId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    expect(home).toContain(`const [${name}, set_${name}] = useState<`);
    expect(home).toContain(`set_${name}((body.result ?? null)`);
    // A row is an object; dropped straight into JSX it would crash React.
    expect(home).toContain(`asText(${name}`);
    expect(home).toContain('function asText(value: unknown): string');
  });

  it('emits no state variable for a screen bucket nothing reads', () => {
    const base = formSnapshot();
    const result = inferBackend(base, { frameId: 'cp_form' });
    if (!result.ok) throw new Error(result.reason);
    const snapshot = applyOps(base, result.proposal.ops);

    const home = fileNamed(compile(snapshot).files, 'src/artboards/Home.tsx');
    expect(home).not.toContain('state_nd_');
    // ...but the pipeline still runs: the button is wired to it.
    expect(home).toContain('"/api/createnotes"');
  });

  it('compiles identically whether the pipeline is proposed, accepted, or detached', () => {
    const { snapshot } = inferredSnapshot();
    const group = Object.values(snapshot.nodes).find((node) => node.auto)!.auto!.group;

    const emitted = (input: Snapshot): string =>
      JSON.stringify(compile(input).files.map((file) => file.content));

    expect(emitted(applyOps(snapshot, [{ type: 'acceptAuto', group }]))).toBe(emitted(snapshot));
    expect(emitted(applyOps(snapshot, [{ type: 'detachAuto', group }]))).toBe(emitted(snapshot));
  });

  it('refuses to run a screen-bucket write on the server', () => {
    const { snapshot, stateId } = inferredSnapshot();
    const route = Object.values(snapshot.nodes).find((node) => node.category === 'api')!;
    const config = route.config as { body: string[] };

    const broken = applyOps(snapshot, [
      { type: 'setNodeConfig', nodeId: route.id, config: { ...config, body: [...config.body, stateId] } },
    ]);

    expect(() => compile(broken)).toThrow(/cannot sit inside an API route/);
  });
});
