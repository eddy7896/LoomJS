import { describe, expect, it } from 'vitest';
import { CompileError, compile } from '../src/index';
import { masterDetailSnapshot, trivialSnapshot } from './fixtures';

const fileAt = (snapshot: Parameters<typeof compile>[0], path: string): string => {
  const found = compile(snapshot).files.find((f) => f.path === path);
  if (!found) throw new Error(`no emitted file at ${path}`);
  return found.content;
};

describe('flow arrows -> react-router (M2)', () => {
  it('emits one route per artboard, entry at /', () => {
    const app = fileAt(masterDetailSnapshot(), 'src/App.tsx');
    expect(app).toContain("import { BrowserRouter, Route, Routes } from 'react-router-dom'");
    expect(app).toContain('<Route path="/" element={<Home />} />');
    expect(app).toContain('<Route path="/item-detail/:id" element={<ItemDetail />} />');
  });

  it('still emits a single route for a one-artboard project', () => {
    const app = fileAt(trivialSnapshot(), 'src/App.tsx');
    expect(app).toContain('<Route path="/" element={<Home />} />');
    expect(app.match(/<Route /g)).toHaveLength(1);
  });

  it('compiles a click on a flow into a navigate call carrying the payload', () => {
    const home = fileAt(masterDetailSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain("import { useNavigate } from 'react-router-dom'");
    expect(home).toContain('const navigate = useNavigate();');
    expect(home).toContain('onClick={() => navigate("/item-detail" + "/" + encodeURIComponent(String("42")))}');
  });

  it('reads a declared param in the destination artboard', () => {
    const detail = fileAt(masterDetailSnapshot(), 'src/artboards/ItemDetail.tsx');
    expect(detail).toContain("import { useParams } from 'react-router-dom'");
    expect(detail).toContain('const params = useParams();');
    expect(detail).toContain('{params.id ?? ""}');
  });

  it('does not import router hooks into an artboard that uses none', () => {
    const home = fileAt(trivialSnapshot(), 'src/artboards/Home.tsx');
    expect(home).not.toContain('react-router-dom');
  });

  it('adds react-router-dom to the emitted app', () => {
    expect(fileAt(trivialSnapshot(), 'package.json')).toContain('react-router-dom');
  });
});

describe('flow errors (Build tier)', () => {
  it('rejects a payload the destination does not declare', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.flows.fl_1!.payload = [{ kind: 'static', param: 'nope', value: 1 }];
    expect(() => compile(snapshot)).toThrow(/does not declare/);
  });

  it('rejects a dynamic route reached without a value for its param', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.flows.fl_1!.payload = [];
    expect(() => compile(snapshot)).toThrow(/missing a value for param "id"/);
  });

  it('rejects a payload sourced from a node port until M3', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.flows.fl_1!.payload = [
      { kind: 'bound', param: 'id', source: { nodeId: 'nd_x', portId: 'pt_x' } },
    ];
    expect(() => compile(snapshot)).toThrow(/binding runtime \(M3\)/);
  });

  it('rejects a param read that the artboard does not declare', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.components.cp_detail_text!.props.content = { kind: 'param', name: 'missing' };
    expect(() => compile(snapshot)).toThrow(/does not declare/);
  });

  it('rejects a flow that ends nowhere', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.flows.fl_1!.to = 'ab_ghost';
    const error = (() => {
      try {
        compile(snapshot);
      } catch (e) {
        return e as CompileError;
      }
    })();
    expect(error).toBeInstanceOf(CompileError);
    expect(error!.message).toMatch(/unknown artboard/);
  });

  it('rejects a trigger that points at no pipeline on this screen', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.components.cp_button!.props.onClick = {
      kind: 'event',
      handler: { kind: 'trigger', target: { nodeId: 'nd_ghost', portId: 'pt_run' } },
    };
    expect(() => compile(snapshot)).toThrow(/not a pipeline on this screen/);
  });
});

describe('empty payload values', () => {
  it('treats an empty static payload as a missing param, not an empty segment', () => {
    const snapshot = masterDetailSnapshot();
    snapshot.flows.fl_1!.payload = [{ kind: 'static', param: 'id', value: '' }];
    expect(() => compile(snapshot)).toThrow(/missing a value for param "id"/);
  });
});
