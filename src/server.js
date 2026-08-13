import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';

import { openDatabase } from './database/connection.js';
import { createApiRouter } from './api/routes.js';

const HOST = '127.0.0.1';
const PORT = 3180;
const publicPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ database } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, service: 'inventario-terreno' });
  });

  if (database) {
    app.use('/api', createApiRouter(database));
  }

  app.use(express.static(publicPath));

  app.use((error, _request, response, _next) => {
    console.error('Error interno del servicio local.');
    response.status(500).json({ error: 'Error interno del servicio local.' });
  });

  return app;
}

export function startServer() {
  const database = openDatabase();
  const app = createApp({ database });
  const server = app.listen(PORT, HOST, () => {
    console.log(`Inventario Terreno disponible en http://localhost:${PORT}`);
  });

  const close = () => {
    server.close(() => database.close());
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  return { app, database, server };
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  startServer();
}
