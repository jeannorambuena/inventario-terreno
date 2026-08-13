import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

const observationStatuses = [
  'verificado',
  'otra_ubicacion',
  'no_ubicado',
  'desconocido',
  'dato_distinto',
];

const locationIdSchema = z.coerce.number().int().positive();
const sessionIdSchema = z.coerce.number().int().positive();

const sessionSchema = z.object({
  locationId: locationIdSchema,
});

const observationSchema = z.object({
  assetId: z.number().int().positive().nullable().optional(),
  provisionalCode: z.string().trim().max(200).nullable().optional(),
  status: z.enum(observationStatuses),
  locationId: z.number().int().positive(),
  observation: z.string().trim().max(2000).default(''),
  observedAt: z.iso.datetime().optional(),
}).superRefine(({ assetId, provisionalCode, status, observation }, context) => {
  const hasAsset = Boolean(assetId);
  const hasProvisionalCode = Boolean(provisionalCode);

  if (hasAsset === hasProvisionalCode) {
    context.addIssue({
      code: 'custom',
      message: 'Debe indicar exclusivamente assetId o provisionalCode.',
    });
  }

  if (hasProvisionalCode && status !== 'desconocido') {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'Un hallazgo provisional debe registrarse como desconocido.',
    });
  }

  if (hasProvisionalCode && !observation) {
    context.addIssue({
      code: 'custom',
      path: ['observation'],
      message: 'Un hallazgo provisional requiere una observación.',
    });
  }
});

function assetProjection() {
  return `
    SELECT
      a.id,
      a.asset_code AS assetCode,
      a.scanner_code AS scannerCode,
      a.name,
      a.brand,
      a.serial_number AS serialNumber,
      a.model,
      a.color,
      a.finbaja,
      a.location_id AS locationId,
      l.direction,
      l.department,
      l.section
    FROM assets a
    LEFT JOIN locations l ON l.id = a.location_id
  `;
}

function getSessionSummary(database, sessionId) {
  const session = database.prepare(`
    SELECT
      s.id,
      s.session_code AS sessionCode,
      s.location_id AS locationId,
      s.status_code AS status,
      s.started_at AS startedAt,
      s.completed_at AS completedAt,
      l.direction,
      l.department,
      l.section
    FROM inventory_sessions s
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE s.id = ?
  `).get(sessionId);

  if (!session) return null;

  const { total } = database
    .prepare('SELECT COUNT(*) AS total FROM assets WHERE location_id = ?')
    .get(session.locationId);
  const metrics = database.prepare(`
    SELECT
      COUNT(o.id) AS observationCount,
      COUNT(DISTINCT CASE
        WHEN o.status_code = 'verificado' AND a.location_id = ? THEN o.asset_id
      END) AS verifiedExpected,
      SUM(CASE WHEN o.status_code = 'otra_ubicacion' THEN 1 ELSE 0 END) AS locationDifferences,
      SUM(CASE WHEN o.asset_id IS NULL THEN 1 ELSE 0 END) AS provisionalFindings
    FROM observations o
    LEFT JOIN assets a ON a.id = o.asset_id
    WHERE o.inventory_session_id = ?
  `).get(session.locationId, sessionId);
  const statusCounts = Object.fromEntries(
    database.prepare(`
      SELECT status_code AS status, COUNT(*) AS count
      FROM observations
      WHERE inventory_session_id = ?
      GROUP BY status_code
      ORDER BY status_code
    `).all(sessionId).map(({ status, count }) => [status, count]),
  );

  return {
    ...session,
    totalAssets: total,
    observationCount: metrics.observationCount,
    verifiedExpected: metrics.verifiedExpected,
    locationDifferences: metrics.locationDifferences,
    provisionalFindings: metrics.provisionalFindings,
    observed: metrics.verifiedExpected,
    pending: Math.max(total - metrics.verifiedExpected, 0),
    progressPercent: total === 0
      ? 0
      : Math.min(Math.round((metrics.verifiedExpected / total) * 100), 100),
    statusCounts,
  };
}

export function createApiRouter(database) {
  const router = Router();

  router.get('/locations', (_request, response) => {
    const locations = database.prepare(`
      SELECT id, direction, department, section
      FROM locations
      ORDER BY direction COLLATE NOCASE, department COLLATE NOCASE, section COLLATE NOCASE
    `).all();
    response.json({ locations });
  });

  router.get('/assets', (request, response) => {
    const parsed = locationIdSchema.safeParse(request.query.locationId);
    if (!parsed.success) {
      return response.status(400).json({ error: 'locationId inválido.' });
    }
    const assets = database.prepare(`${assetProjection()} WHERE a.location_id = ? ORDER BY a.asset_code`).all(parsed.data);
    return response.json({ assets });
  });

  router.get('/assets/search', (request, response) => {
    const query = String(request.query.q ?? '').trim();
    if (!query) return response.status(400).json({ error: 'Debe indicar q.' });
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const assets = database.prepare(`
      ${assetProjection()}
      WHERE a.asset_code LIKE ? ESCAPE '\\'
         OR a.scanner_code LIKE ? ESCAPE '\\'
         OR a.name LIKE ? ESCAPE '\\'
      ORDER BY a.asset_code
      LIMIT 50
    `).all(pattern, pattern, pattern);
    return response.json({ assets });
  });

  router.get('/assets/by-code/:code', (request, response) => {
    const code = String(request.params.code ?? '').trim();
    const asset = database.prepare(`
      ${assetProjection()}
      WHERE a.asset_code = ? OR a.scanner_code = ?
      ORDER BY CASE WHEN a.asset_code = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(code, code, code);
    if (!asset) return response.status(404).json({ error: 'Bien no encontrado.' });
    return response.json({ asset });
  });

  router.post('/sessions', (request, response) => {
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Datos de sesión inválidos.' });
    const location = database.prepare('SELECT id FROM locations WHERE id = ?').get(parsed.data.locationId);
    if (!location) return response.status(404).json({ error: 'Ubicación no encontrada.' });
    const created = database.prepare(`
      INSERT INTO inventory_sessions (session_code, location_id, status_code, started_at)
      VALUES (?, ?, 'open', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      RETURNING id, session_code AS sessionCode, location_id AS locationId,
        status_code AS status, started_at AS startedAt
    `).get(randomUUID(), parsed.data.locationId);
    return response.status(201).json({ session: created });
  });

  router.post('/sessions/:id/observations', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = observationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({ error: 'Observación inválida.' });
    }
    const session = database
      .prepare('SELECT status_code AS status, location_id AS locationId FROM inventory_sessions WHERE id = ?')
      .get(sessionId.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    if (session.status !== 'open') return response.status(409).json({ error: 'La sesión está cerrada.' });
    if (!database.prepare('SELECT id FROM locations WHERE id = ?').get(parsed.data.locationId)) {
      return response.status(404).json({ error: 'Ubicación no encontrada.' });
    }
    if (parsed.data.locationId !== session.locationId) {
      return response.status(409).json({ error: 'La ubicación seleccionada no corresponde a la sesión.' });
    }
    const asset = parsed.data.assetId
      ? database.prepare('SELECT id, location_id AS locationId FROM assets WHERE id = ?').get(parsed.data.assetId)
      : null;
    if (parsed.data.assetId && !asset) {
      return response.status(404).json({ error: 'Bien no encontrado.' });
    }
    if (parsed.data.status === 'verificado' && asset.locationId !== parsed.data.locationId) {
      return response.status(409).json({
        error: 'El bien pertenece a otra ubicación; use el estado otra_ubicacion.',
      });
    }
    const observedAt = parsed.data.observedAt ?? new Date().toISOString();
    const observation = database.prepare(`
      INSERT INTO observations (
        observation_code, inventory_session_id, asset_id, provisional_code,
        status_code, selected_location_id, notes, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id, asset_id AS assetId, provisional_code AS provisionalCode,
        inventory_session_id AS sessionId,
        status_code AS status, selected_location_id AS locationId,
        notes AS observation, observed_at AS observedAt
    `).get(
      randomUUID(),
      sessionId.data,
      parsed.data.assetId ?? null,
      parsed.data.provisionalCode || null,
      parsed.data.status,
      parsed.data.locationId,
      parsed.data.observation,
      observedAt,
    );
    return response.status(201).json({ observation });
  });

  router.get('/sessions/:id/summary', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const summary = getSessionSummary(database, parsed.data);
    if (!summary) return response.status(404).json({ error: 'Sesión no encontrada.' });
    return response.json({ summary });
  });

  router.post('/sessions/:id/close', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const closed = database.prepare(`
      UPDATE inventory_sessions
      SET status_code = 'closed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status_code = 'open'
    `).run(parsed.data);
    if (closed.changes === 0 && !getSessionSummary(database, parsed.data)) {
      return response.status(404).json({ error: 'Sesión no encontrada.' });
    }
    return response.json({ summary: getSessionSummary(database, parsed.data) });
  });

  return router;
}
