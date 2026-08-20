import { createServer } from 'node:http';

/**
 * A stand-in that speaks PostgREST's protocol: the OpenAPI schema document Supabase serves at
 * `/rest/v1/`, plus reads and writes on one table. It exists so the editor loop can be driven end
 * to end without an account — pointing the studio at a real project is the same URL and key flow.
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

const rows = [{ id: 1, title: 'first note', body: null }];

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.end();
    return;
  }

  if (url.pathname === '/rest/v1/' || url.pathname === '/rest/v1') {
    send(res, 200, OPENAPI);
    return;
  }

  if (url.pathname === '/rest/v1/notes') {
    if (req.method === 'GET') {
      send(res, 200, rows);
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const inserted = { id: rows.length + 1, body: null, ...body };
        rows.push(inserted);
        // `.single()` asks for one object rather than an array, via Accept.
        const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
        send(res, 201, wantsObject ? inserted : [inserted]);
      });
      return;
    }
  }

  send(res, 404, { message: 'not found' });
}).listen(PORT, () => {
  console.log(`postgrest stub on ${PORT}`);
});
