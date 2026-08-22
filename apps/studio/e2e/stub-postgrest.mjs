import { createServer } from 'node:http';

/**
 * A stand-in that speaks PostgREST's protocol: the OpenAPI schema document Supabase serves at
 * `/rest/v1/`, plus reads and writes on one table. It exists so the editor loop can be driven end
 * to end without an account — pointing the studio at a real project is the same URL and key flow.
 *
 * It understands the four verbs and the filter grammar the compiler emits (`col=eq.1`,
 * `col=ilike.*term*`), because the point of a protocol stub is that the client cannot tell.
 *
 * It also speaks the part of GoTrue that P5 needs — sign up, sign in, refresh, sign out and who
 * am I — so an emitted app can hold a real session against it (`docs/specs/app-auth.md`).
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

/** Accounts, and the tokens handed out for them. Nothing is hashed; nothing here is real. */
const accounts = new Map();
const tokens = new Map();

/**
 * A token that carries its own expiry, because the emitted server reads `exp` from the payload to
 * decide when to spend the refresh token. Unsigned: only Supabase would ever check a signature.
 */
function mint(userId) {
  const claims = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const token = `header.${claims}.signature`;
  tokens.set(token, userId);
  return token;
}

const sessionFor = (userId, email) => ({
  access_token: mint(userId),
  refresh_token: `refresh-${userId}`,
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: userId, email },
});

const bearerOf = (req) => (req.headers.authorization ?? '').replace(/^Bearer /, '');

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

  // ---- GoTrue -------------------------------------------------------------

  if (url.pathname === '/auth/v1/signup') {
    void readBody(req).then((body) => {
      const email = String(body.email ?? '');
      const existing = accounts.get(email);
      const id = existing?.id ?? `user-${accounts.size + 1}`;
      accounts.set(email, { id, password: String(body.password ?? '') });
      send(res, 200, sessionFor(id, email));
    });
    return;
  }

  if (url.pathname === '/auth/v1/token') {
    void readBody(req).then((body) => {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const entry = [...accounts].find(([, account]) => body.refresh_token === `refresh-${account.id}`);
        if (!entry) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, sessionFor(entry[1].id, entry[0]));
      }
      const email = String(body.email ?? '');
      const account = accounts.get(email);
      if (!account || account.password !== String(body.password ?? '')) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      send(res, 200, sessionFor(account.id, email));
    });
    return;
  }

  if (url.pathname === '/auth/v1/user') {
    const who = tokens.get(bearerOf(req));
    if (!who) return send(res, 401, { message: 'invalid token' });
    const email = [...accounts].find(([, account]) => account.id === who)?.[0] ?? '';
    send(res, 200, { id: who, email });
    return;
  }

  if (url.pathname === '/auth/v1/logout') {
    tokens.delete(bearerOf(req));
    send(res, 200, {});
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
    accounts.clear();
    tokens.clear();
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
