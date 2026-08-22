import { createServer } from 'node:http';

/**
 * A stand-in that speaks PostgREST's protocol: the OpenAPI schema document Supabase serves at
 * `/rest/v1/`, plus reads and writes on one table. It exists so the editor loop can be driven end
 * to end without an account — pointing the studio at a real project is the same URL and key flow.
 *
 * It understands the four verbs and the filter grammar the compiler emits (`col=eq.1`,
 * `col=ilike.*term*`), because the point of a protocol stub is that the client cannot tell.
 */

const PORT = Number(process.env.STUB_PORT ?? 5412);

const OPENAPI = {
  swagger: '2.0',
  info: { title: 'standard public schema' },
  definitions: {
    notes: {
      required: ['id', 'title'],
      properties: {
        id: { format: 'bigint', type: 'integer', description: 'Note:\nThis is a Primary Key.<pk/>' },
        title: { format: 'text', type: 'string' },
        body: { format: 'text', type: 'string' },
      },
    },
  },
};

let rows = [{ id: 1, title: 'first note', body: null }];
let nextId = 2;

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : {});
    });
  });

/** `.single()` asks for one object rather than an array, via Accept. */
const wantsObject = (req) => (req.headers.accept ?? '').includes('vnd.pgrst.object+json');

/**
 * PostgREST puts filters in the query string as `column=operator.value`. Values are compared
 * loosely on purpose: an id arrives as the string "1" and lives in the row as the number 1.
 */
function matches(row, url) {
  for (const [column, raw] of url.searchParams) {
    if (column === 'select' || column === 'order' || column === 'limit' || column === 'offset') {
      continue;
    }
    const [operator, ...rest] = String(raw).split('.');
    const value = rest.join('.');
    const actual = row[column];

    switch (operator) {
      case 'eq':
        if (String(actual) !== value) return false;
        break;
      case 'neq':
        if (String(actual) === value) return false;
        break;
      case 'gt':
        if (!(Number(actual) > Number(value))) return false;
        break;
      case 'lt':
        if (!(Number(actual) < Number(value))) return false;
        break;
      case 'ilike': {
        const needle = value.replace(/[*%]/g, '').toLowerCase();
        if (!String(actual ?? '').toLowerCase().includes(needle)) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.end();
    return;
  }

  if (url.pathname === '/rest/v1/' || url.pathname === '/rest/v1') {
    send(res, 200, OPENAPI);
    return;
  }

  // Lets a spec put the table back to a known state between runs.
  if (url.pathname === '/__reset') {
    rows = [{ id: 1, title: 'first note', body: null }];
    nextId = 2;
    send(res, 200, { ok: true });
    return;
  }

  if (url.pathname !== '/rest/v1/notes') {
    send(res, 404, { message: 'not found' });
    return;
  }

  const selected = rows.filter((row) => matches(row, url));

  if (req.method === 'GET') {
    const order = url.searchParams.get('order');
    const ordered = [...selected];
    if (order) {
      const [column, direction] = order.split('.');
      ordered.sort((a, b) => {
        const left = a[column];
        const right = b[column];
        const sign = left === right ? 0 : left > right ? 1 : -1;
        return direction === 'desc' ? -sign : sign;
      });
    }
    const limit = Number(url.searchParams.get('limit') ?? 0);
    send(res, 200, limit > 0 ? ordered.slice(0, limit) : ordered);
    return;
  }

  if (req.method === 'POST') {
    void readBody(req).then((body) => {
      const inserted = { id: nextId++, body: null, ...body };
      rows.push(inserted);
      send(res, 201, wantsObject(req) ? inserted : [inserted]);
    });
    return;
  }

  if (req.method === 'PATCH') {
    void readBody(req).then((patch) => {
      if (selected.length === 0) {
        send(res, 406, { message: 'no rows matched' });
        return;
      }
      for (const row of selected) Object.assign(row, patch);
      send(res, 200, wantsObject(req) ? selected[0] : selected);
    });
    return;
  }

  if (req.method === 'DELETE') {
    if (selected.length === 0) {
      send(res, 406, { message: 'no rows matched' });
      return;
    }
    rows = rows.filter((row) => !selected.includes(row));
    send(res, 200, wantsObject(req) ? selected[0] : selected);
    return;
  }

  send(res, 405, { message: 'method not allowed' });
}).listen(PORT, () => {
  console.log(`postgrest stub on ${PORT}`);
});
