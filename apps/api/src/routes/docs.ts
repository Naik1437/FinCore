import type { Request, Response } from 'express';
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

export const docsRouter = Router();

// Load OpenAPI spec path searching candidate paths for monorepo and workspace test runners
const candidatePaths = [
  path.resolve(process.cwd(), 'docs/openapi.json'),
  path.resolve(process.cwd(), '../../docs/openapi.json'),
  path.resolve(__dirname, '../../../../docs/openapi.json'),
  path.resolve(__dirname, '../../../docs/openapi.json'),
];
const openApiPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];

docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  if (fs.existsSync(openApiPath)) {
    const spec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
    res.json(spec);
  } else {
    res.status(404).json({ error: 'OpenAPI specification not found' });
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

// CSP-safe server-rendered API documentation. No CDN or inline JavaScript is required.
docsRouter.get('/', (_req: Request, res: Response) => {
  if (!fs.existsSync(openApiPath)) {
    res.status(404).send('OpenAPI specification not found');
    return;
  }

  const spec = JSON.parse(fs.readFileSync(openApiPath, 'utf8')) as {
    info?: { title?: string; version?: string; description?: string };
    paths?: Record<string, Record<string, { summary?: string; description?: string }>>;
  };
  const endpointMarkup = Object.entries(spec.paths || {})
    .flatMap(([route, methods]) =>
      Object.entries(methods).map(([method, operation]) => `
        <article class="endpoint">
          <div><span class="method method-${escapeHtml(method)}">${escapeHtml(method.toUpperCase())}</span>
          <code>${escapeHtml(route)}</code></div>
          <p>${escapeHtml(operation.summary || operation.description || 'API operation')}</p>
        </article>`)
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(spec.info?.title || 'FinCore API Documentation')}</title>
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fincore-header {
      background: #0f172a;
      color: #fff;
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .fincore-header h1 { margin: 0; font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .fincore-badge {
      background: #0284c7;
      color: #fff;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 24px 32px 48px; }
    .endpoint { background: #fff; border: 1px solid #dbe3ef; border-radius: 6px; margin: 12px 0; padding: 14px 18px; }
    .endpoint code { font-size: 15px; color: #172033; }
    .endpoint p { color: #475569; margin: 8px 0 0; }
    .method { display: inline-block; min-width: 64px; margin-right: 12px; padding: 4px 7px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 700; text-align: center; }
    .method-get { background: #16803c; } .method-post { background: #1769aa; } .method-patch { background: #9a6700; }
    .method-put { background: #8250df; } .method-delete { background: #cf222e; }
  </style>
</head>
<body>
  <div class="fincore-header">
    <h1>💳 FinCore Core Banking & Financial API</h1>
    <span class="fincore-badge">OpenAPI 3.0.3</span>
  </div>
  <main>
    <h2>${escapeHtml(spec.info?.title || 'FinCore API')}</h2>
    <p>${escapeHtml(spec.info?.description || 'OpenAPI endpoint reference')}</p>
    <p>Version ${escapeHtml(spec.info?.version || 'unknown')} · Raw specification: <a href="/docs/openapi.json">/docs/openapi.json</a></p>
    ${endpointMarkup}
  </main>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
