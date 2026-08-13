import request from 'supertest';
import { describe, expect, test } from 'vitest';

import { createApp } from '../src/server.js';

describe('GET /api/health', () => {
  test('reports that the local service is available', async () => {
    const response = await request(createApp())
      .get('/api/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      service: 'inventario-terreno',
    });
  });
});
