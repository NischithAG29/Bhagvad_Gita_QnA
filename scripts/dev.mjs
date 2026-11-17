// Local preview: node scripts/dev.mjs  ->  http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(ROOT, 'api', url.pathname.slice(5) + '.js');
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
      return (await import(file)).default(req, res);
    }
    const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); res.statusCode = 500; res.end(String(e)); }
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
