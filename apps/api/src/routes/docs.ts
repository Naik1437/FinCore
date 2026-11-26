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

// Self-contained Swagger UI HTML without external build tools or paid CDNs
docsRouter.get('/', (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FinCore API Documentation - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .topbar { display: none !important; }
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
  </style>
</head>
<body>
  <div class="fincore-header">
    <h1>💳 FinCore Core Banking & Financial API</h1>
    <span class="fincore-badge">OpenAPI 3.0.3</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
