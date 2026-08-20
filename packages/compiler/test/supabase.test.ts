import { describe, expect, it } from 'vitest';
import { compile } from '../src/index';
import { supabaseSnapshot } from './fixtures';

type Snapshot = Parameters<typeof compile>[0];

const fileAt = (snapshot: Snapshot, path: string): string => {
  const files = compile(snapshot).files;
  const found = files.find((f) => f.path === path);
  if (!found) {
    throw new Error(`no emitted file at ${path}. Got: ${files.map((f) => f.path).join(', ')}`);
  }
  return found.content;
};

describe('database nodes -> server code (M4)', () => {
  it('emits a Supabase read inside the serverless function', () => {
    const api = fileAt(supabaseSnapshot(), 'api/notes.ts');
    expect(api).toContain("import { PostgrestClient } from '@supabase/postgrest-js'");
    expect(api).toContain(".from(\"notes\")");
    expect(api).toContain(".select('*')");
  });

  it('emits an insert that writes the posted row', () => {
    const api = fileAt(supabaseSnapshot(), 'api/createnote.ts');
    expect(api).toContain('.insert(row).select().single()');
  });

  it('reads credentials by name and never inlines a value', () => {
    const api = fileAt(supabaseSnapshot(), 'api/notes.ts');
    expect(api).toContain('process.env.SUPABASE_URL');
    expect(api).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');

    // Nothing key-shaped may reach any emitted file, nor the document it came from.
    const snapshot = supabaseSnapshot();
    expect(JSON.stringify(snapshot.connectors)).not.toMatch(/key|secret|token/i);
    for (const file of compile(snapshot).files) {
      expect(file.content).not.toMatch(/eyJhbGciOi/); // a JWT, which every Supabase key is
    }
  });

  it('lists the credential names the project needs, with no values', () => {
    const example = fileAt(supabaseSnapshot(), '.env.example');
    expect(example).toBe('SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=\n');
  });

  it('adds the Supabase client only to a project that uses the database', () => {
    expect(fileAt(supabaseSnapshot(), 'package.json')).toContain('@supabase/postgrest-js');
  });
});

describe('reading rows into the UI', () => {
  it('runs the read reactively, since nothing triggers it', () => {
    const home = fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain('useEffect(() => {');
    expect(home).toContain('void run_nd_read();');
  });

  it('types the result state from the route, which took it from its body', () => {
    const home = fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain(
      'const [result_nd_read, set_result_nd_read] = useState<Record<string, unknown>[] | null>(null)',
    );
  });

  it('renders the List as an implicit map over the rows', () => {
    const home = fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain('(result_nd_read ?? []).map((item_cp_list: Record<string, unknown>');
    expect(home).toContain('item_cp_list["title"] ?? ""');
  });

  it('shows the empty text when there are no rows', () => {
    const home = fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain('(result_nd_read ?? []).length === 0');
    expect(home).toContain('{"No notes yet"}');
  });
});

describe('writing a row from a form', () => {
  it('posts the wired columns as the row to insert', () => {
    const home = fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx');
    expect(home).toContain('await fetch("/api/createnote", {');
    expect(home).toContain('body: JSON.stringify({ input: { "title": field_cp_title } })');
  });

  it('fires the write from the button that submits it', () => {
    expect(fileAt(supabaseSnapshot(), 'src/artboards/Home.tsx')).toContain(
      'onClick={() => void run_nd_write()}',
    );
  });
});

describe('the security gate is a build gate', () => {
  it('refuses a database node that is not inside an API route', () => {
    const snapshot = supabaseSnapshot();
    snapshot.nodes.nd_read!.config = { method: 'POST', path: 'notes', body: [] };
    expect(() => compile(snapshot)).toThrow(/must sit inside an API route/);
  });

  it('refuses a document that carries a credential value', () => {
    const snapshot = supabaseSnapshot();
    snapshot.connectors.cn_supabase!.config = {
      url: 'https://demo.supabase.co',
      serviceKey: 'eyJhbGciOiJIUzI1NiJ9.secret',
    };
    expect(() => compile(snapshot)).toThrow(/referenced by name, never stored/);
  });

  it('refuses a database node with no connection behind it', () => {
    const snapshot = supabaseSnapshot();
    snapshot.nodes.nd_select!.config = { table: 'notes', operation: 'select' };
    expect(() => compile(snapshot)).toThrow(/not attached to a connection/);
  });

  it('refuses a database node with no table chosen', () => {
    const snapshot = supabaseSnapshot();
    snapshot.nodes.nd_select!.config = { connectorId: 'cn_supabase', operation: 'select' };
    expect(() => compile(snapshot)).toThrow(/no table selected/);
  });

  it('refuses a row field read outside a List', () => {
    const snapshot = supabaseSnapshot();
    snapshot.components.cp_text000001!.props.content = { kind: 'item', field: 'title' };
    expect(() => compile(snapshot)).toThrow(/is not inside a List/);
  });
});
