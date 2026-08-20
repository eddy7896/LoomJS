import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { pipelineSnapshot } from './fixtures';

type Snapshot = Parameters<typeof compile>[0];

const fileAt = (snapshot: Snapshot, path: string): string => {
  const files = compile(snapshot).files;
  const found = files.find((f) => f.path === path);
  if (!found) {
    throw new Error(`no emitted file at ${path}. Got: ${files.map((f) => f.path).join(', ')}`);
  }
  return found.content;
};

describe('backend graph -> serverless (M3)', () => {
  it('emits one Vercel function per API route node', () => {
    const api = fileAt(pipelineSnapshot(), 'api/shout.ts');
    expect(api).toContain('export default async function handler');
    expect(api).toContain("import type { IncomingMessage, ServerResponse } from 'node:http'");
    // The Compute node's operation runs on the server, inside the API node's body.
    expect(api).toContain('value = String(value).toUpperCase();');
    expect(api).toContain('JSON.stringify({ result: value })');
  });

  it('emits the client pipeline as plain state and a fetch, with no runtime library', () => {
    const home = fileAt(pipelineSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain("import { useCallback, useState } from 'react'");
    // The result state is typed from the route's result port, which the container took from
    // its body: an uppercase step returns text.
    expect(home).toContain(
      'const [result_nd_api, set_result_nd_api] = useState<string | null>(null)',
    );
    expect(home).toContain('const run_nd_api = useCallback(async () => {');
    expect(home).toContain('await fetch("/api/shout", {');
    expect(home).toContain('body: JSON.stringify({ input: field_cp_field })');
  });

  it('fires the pipeline from the wired trigger', () => {
    expect(fileAt(pipelineSnapshot(), 'src/artboards/Home.tsx')).toContain(
      'onClick={() => void run_nd_api()}',
    );
  });

  it('compiles a bound property into a read of the pipeline state', () => {
    expect(fileAt(pipelineSnapshot(), 'src/artboards/Home.tsx')).toContain(
      '<span>{result_nd_api ?? ""}</span>',
    );
  });

  it('emits a controlled input whose state feeds the pipeline', () => {
    const home = fileAt(pipelineSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain('const [field_cp_field, set_field_cp_field] = useState("")');
    expect(home).toContain('onChange={(event) => set_field_cp_field(event.target.value)}');
  });

  it('runs a pipeline with no trigger reactively instead', () => {
    const snapshot = pipelineSnapshot();
    delete snapshot.wires.wr_trigger;
    delete snapshot.components.cp_send!.props.onClick;
    const home = fileAt(snapshot, 'src/artboards/Home.tsx');
    expect(home).toContain('useEffect(() => {');
    expect(home).toContain('void run_nd_api();');
  });

  it('serves the emitted functions in dev so the Preview runs real server code', () => {
    const config = fileAt(pipelineSnapshot(), 'vite.config.ts');
    expect(config).toContain("name: 'loom:dev-api'");
    expect(config).toContain("server.ssrLoadModule('/api/' + name + '.ts')");
  });

  it('emits a Code node body verbatim inside the server function', () => {
    const snapshot = pipelineSnapshot();
    snapshot.nodes.nd_compute = {
      ...snapshot.nodes.nd_compute!,
      kind: 'code',
      config: { source: 'return String(input).length;' },
    };
    expect(fileAt(snapshot, 'api/shout.ts')).toContain('return String(input).length;');
  });
});

describe('pipeline errors (Build tier)', () => {
  it('refuses a wire whose types do not line up', () => {
    const snapshot = pipelineSnapshot();
    snapshot.nodes.nd_api!.ports = snapshot.nodes.nd_api!.ports.map((port) =>
      port.id === 'pt_input' ? { ...port, type: { kind: 'number' } } : port,
    );
    expect(() => compile(snapshot)).toThrow(/not assignable/);
  });

  it('refuses a data wire into a trigger port', () => {
    const snapshot = pipelineSnapshot();
    snapshot.wires.wr_input!.to = { nodeId: 'nd_api', portId: 'pt_run' };
    expect(() => compile(snapshot)).toThrow(/data port to a trigger port/);
  });

  it('refuses a binding to a node no pipeline on the screen produces', () => {
    const snapshot = pipelineSnapshot();
    snapshot.components.cp_output!.props.content = {
      kind: 'bound',
      source: { nodeId: 'nd_ghost', portId: 'pt_result' },
    };
    expect(() => compile(snapshot)).toThrow(/no pipeline on this screen produces/);
  });

  it('refuses an API route whose body holds a node that cannot run on the server', () => {
    const snapshot = pipelineSnapshot();
    snapshot.nodes.nd_compute!.category = 'ui';
    snapshot.nodes.nd_compute!.kind = 'mirror';
    expect(() => compile(snapshot)).toThrow(/cannot run inside an API route/);
  });

  it('refuses an empty Code node body', () => {
    const snapshot = pipelineSnapshot();
    snapshot.nodes.nd_compute = {
      ...snapshot.nodes.nd_compute!,
      kind: 'code',
      config: { source: '  ' },
    };
    expect(() => compile(snapshot)).toThrow(/empty body/);
  });
});
