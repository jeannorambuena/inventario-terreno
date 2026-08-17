import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import express from 'express';

import { openDatabase } from './database/connection.js';
import { createApiRouter } from './api/routes.js';
import { getMobileNetworkInfo, getPrivateIPv4Addresses, isLocalClient } from './network.js';

const HOST = '0.0.0.0';
const PORT = 3180;
const HTTPS_PORT = 3443;
const publicPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ database, networkInfoProvider = getMobileNetworkInfo } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    if (!isLocalClient(request.socket.remoteAddress)) {
      return response.status(403).json({ error: 'Acceso permitido solo desde la red local.' });
    }
    return next();
  });
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, service: 'inventario-terreno' });
  });

  if (database) {
    app.use('/api', createApiRouter(database, { networkInfoProvider }));
  }

  app.get('/mobile', (_request, response) => response.sendFile(resolve(publicPath, 'mobile.html')));
  app.get('/vendor/zxing-browser.min.js', (_request, response) => {
    response.sendFile(resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'node_modules',
      '@zxing',
      'browser',
      'umd',
      'zxing-browser.min.js',
    ));
  });

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
  const mobileNetwork = getMobileNetworkInfo();
  const server = app.listen(PORT, HOST, () => {
    console.log(`Inventario Terreno disponible en http://localhost:${PORT}`);
    if (mobileNetwork.baseUrl) {
      console.log(`Acceso móvil configurado mediante MOBILE_BASE_URL: ${mobileNetwork.baseUrl}/mobile`);
    } else if (mobileNetwork.selected) {
      for (const candidate of mobileNetwork.candidates) {
        console.log(`Candidata LAN física: ${candidate.interface} (${candidate.address})`);
      }
      console.log(`Interfaz LAN seleccionada: ${mobileNetwork.selected.interface} (${mobileNetwork.selected.address})`);
      console.log(`Acceso móvil disponible en http://${mobileNetwork.selected.address}:${PORT}/mobile`);
    } else {
      console.warn(mobileNetwork.warning);
    }
  });

  const certificatePath = process.env.INVENTARIO_TLS_CERT_PATH?.trim();
  const keyPath = process.env.INVENTARIO_TLS_KEY_PATH?.trim();
  let httpsServer = null;
  if (certificatePath && keyPath) {
    httpsServer = createHttpsServer({
      cert: readFileSync(certificatePath),
      key: readFileSync(keyPath),
    }, app).listen(HTTPS_PORT, HOST, () => {
      console.log(`Inventario Terreno HTTPS disponible en https://localhost:${HTTPS_PORT}`);
      for (const { address } of getPrivateIPv4Addresses()) {
        console.log(`Acceso móvil HTTPS disponible en https://${address}:${HTTPS_PORT}/mobile`);
      }
    });
  }

  const close = () => {
    let pendingServers = httpsServer ? 2 : 1;
    const closeDatabase = () => {
      pendingServers -= 1;
      if (pendingServers === 0) database.close();
    };
    server.close(closeDatabase);
    httpsServer?.close(closeDatabase);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  return { app, database, server, httpsServer };
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryPoint === import.meta.url) {
  startServer();
}
