import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Router } from 'express';
import QRCode from 'qrcode';
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

const mobileObservationSchema = z.object({
  code: z.string().trim().min(1).max(200),
  assetId: z.number().int().positive().optional(),
  status: z.enum(observationStatuses),
  observation: z.string().trim().max(2000).default(''),
  observedAt: z.iso.datetime().optional(),
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

  if (status !== 'verificado' && !observation) {
    context.addIssue({
      code: 'custom',
      path: ['observation'],
      message: 'El estado seleccionado requiere una observación.',
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

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readPairingToken(request) {
  const authorization = request.get('authorization') ?? '';
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  return String(request.get('x-pairing-token') ?? '').trim();
}

function getPairing(database, sessionId, request) {
  const token = readPairingToken(request);
  if (!token) return { error: 'Token de emparejamiento requerido.', status: 401 };
  const pairing = database.prepare(`
    SELECT p.id, p.inventory_session_id AS sessionId, p.expires_at AS expiresAt,
      p.revoked_at AS revokedAt, s.status_code AS sessionStatus
    FROM session_pairings p
    JOIN inventory_sessions s ON s.id = p.inventory_session_id
    WHERE p.token_hash = ? AND p.inventory_session_id = ?
  `).get(hashToken(token), sessionId);
  if (!pairing) return { error: 'Token de emparejamiento inválido.', status: 401 };
  if (pairing.revokedAt || pairing.sessionStatus !== 'open' || Date.parse(pairing.expiresAt) <= Date.now()) {
    return { error: 'Token de emparejamiento expirado.', status: 401 };
  }
  return { pairing };
}

function findAssetsByCode(database, code) {
  return database.prepare(`
    ${assetProjection()}
    WHERE a.asset_code = ? OR a.scanner_code = ?
    ORDER BY CASE WHEN a.asset_code = ? THEN 0 ELSE 1 END
  `).all(code, code, code);
}

function classifyAsset(asset, sessionLocationId) {
  if (!asset) return 'desconocido';
  return asset.locationId === sessionLocationId ? 'corresponde' : 'otra_ubicacion';
}

function getObservedAssetIds(database, sessionId, assetIds) {
  if (assetIds.length === 0) return new Set();
  const placeholders = assetIds.map(() => '?').join(', ');
  return new Set(database.prepare(`
    SELECT DISTINCT asset_id AS assetId
    FROM observations
    WHERE inventory_session_id = ? AND asset_id IN (${placeholders})
  `).all(sessionId, ...assetIds).map(({ assetId }) => assetId));
}

function buildLookup(database, sessionId, sessionLocationId, code) {
  const matches = findAssetsByCode(database, code);
  const observedAssetIds = getObservedAssetIds(database, sessionId, matches.map(({ id }) => id));
  const enrichedMatches = matches.map((asset) => ({
    ...asset,
    classification: classifyAsset(asset, sessionLocationId),
    alreadyObserved: observedAssetIds.has(asset.id),
  }));
  return {
    code,
    asset: enrichedMatches.length === 1 ? enrichedMatches[0] : null,
    matches: enrichedMatches,
    ambiguous: enrichedMatches.length > 1,
    classification: enrichedMatches.length === 1
      ? enrichedMatches[0].classification
      : enrichedMatches.length === 0 ? 'desconocido' : 'ambiguo',
    alreadyObserved: enrichedMatches.some(({ alreadyObserved }) => alreadyObserved),
  };
}

function saveObservation(database, sessionId, data) {
  const session = database
    .prepare('SELECT status_code AS status, location_id AS locationId FROM inventory_sessions WHERE id = ?')
    .get(sessionId);
  if (!session) return { error: 'Sesión no encontrada.', status: 404 };
  if (session.status !== 'open') return { error: 'La sesión está cerrada.', status: 409 };
  if (!database.prepare('SELECT id FROM locations WHERE id = ?').get(data.locationId)) {
    return { error: 'Ubicación no encontrada.', status: 404 };
  }
  if (data.locationId !== session.locationId) {
    return { error: 'La ubicación seleccionada no corresponde a la sesión.', status: 409 };
  }
  const asset = data.assetId
    ? database.prepare('SELECT id, location_id AS locationId FROM assets WHERE id = ?').get(data.assetId)
    : null;
  if (data.assetId && !asset) return { error: 'Bien no encontrado.', status: 404 };
  if (data.status === 'verificado' && asset?.locationId !== data.locationId) {
    return { error: 'El bien pertenece a otra ubicación; use el estado otra_ubicacion.', status: 409 };
  }

  const duplicate = data.assetId
    ? database.prepare(`
      SELECT id FROM observations WHERE inventory_session_id = ? AND asset_id = ? LIMIT 1
    `).get(sessionId, data.assetId)
    : database.prepare(`
      SELECT id FROM observations
      WHERE inventory_session_id = ? AND asset_id IS NULL AND provisional_code = ?
      LIMIT 1
    `).get(sessionId, data.provisionalCode);
  if (duplicate) return { error: 'Este bien o código ya fue observado en la sesión.', status: 409 };

  const observedAt = data.observedAt ?? new Date().toISOString();
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
    sessionId,
    data.assetId ?? null,
    data.provisionalCode || null,
    data.status,
    data.locationId,
    data.observation,
    observedAt,
  );
  return { observation };
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
      COALESCE(COUNT(o.id), 0) AS observacionesTotales,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code IN ('verificado', 'dato_distinto', 'no_ubicado')
          THEN o.asset_id
      END), 0) AS bienesEsperadosRevisados,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'verificado' THEN o.asset_id
      END), 0) AS bienesConformes,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'dato_distinto' THEN o.asset_id
      END), 0) AS datosDistintos,
      COALESCE(COUNT(DISTINCT CASE
        WHEN a.location_id = ? AND o.status_code = 'no_ubicado' THEN o.asset_id
      END), 0) AS noUbicados,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.status_code = 'otra_ubicacion' THEN o.asset_id
      END), 0) AS diferenciasUbicacion,
      COALESCE(COUNT(DISTINCT CASE
        WHEN o.asset_id IS NULL THEN o.provisional_code
      END), 0) AS hallazgosProvisionales
    FROM observations o
    LEFT JOIN assets a ON a.id = o.asset_id
    WHERE o.inventory_session_id = ?
  `).get(
    session.locationId,
    session.locationId,
    session.locationId,
    session.locationId,
    sessionId,
  );
  const statusCounts = Object.fromEntries(
    database.prepare(`
      SELECT status_code AS status, COUNT(*) AS count
      FROM observations
      WHERE inventory_session_id = ?
      GROUP BY status_code
      ORDER BY status_code
    `).all(sessionId).map(({ status, count }) => [status, count]),
  );

  const pendientes = Math.max(total - metrics.bienesEsperadosRevisados, 0);
  const porcentajeRevision = total === 0
    ? 0
    : Math.min(Math.round((metrics.bienesEsperadosRevisados / total) * 100), 100);
  const porcentajeConformidad = total === 0
    ? 0
    : Math.min(Math.round((metrics.bienesConformes / total) * 100), 100);

  return {
    ...session,
    bienesEsperados: total,
    bienesEsperadosRevisados: metrics.bienesEsperadosRevisados,
    bienesConformes: metrics.bienesConformes,
    datosDistintos: metrics.datosDistintos,
    noUbicados: metrics.noUbicados,
    diferenciasUbicacion: metrics.diferenciasUbicacion,
    hallazgosProvisionales: metrics.hallazgosProvisionales,
    observacionesTotales: metrics.observacionesTotales,
    pendientes,
    porcentajeRevision,
    porcentajeConformidad,
    // Alias temporales para clientes existentes.
    totalAssets: total,
    observations: metrics.observacionesTotales,
    observationCount: metrics.observacionesTotales,
    verifiedExpected: metrics.bienesConformes,
    locationDifferences: metrics.diferenciasUbicacion,
    provisionalFindings: metrics.hallazgosProvisionales,
    observed: metrics.bienesEsperadosRevisados,
    pending: pendientes,
    progressPercent: porcentajeRevision,
    statusCounts,
  };
}

export function createApiRouter(database, { networkInfoProvider = () => [] } = {}) {
  const router = Router();

  router.get('/network-info', (_request, response) => {
    const addresses = networkInfoProvider();
    response.json({
      port: 3180,
      addresses,
      mobileUrls: addresses.map(({ address }) => `http://${address}:3180/mobile`),
    });
  });

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
    const requestedSessionId = request.query.sessionId
      ? sessionIdSchema.safeParse(request.query.sessionId)
      : null;
    if (requestedSessionId && !requestedSessionId.success) {
      return response.status(400).json({ error: 'Id de sesión inválido.' });
    }
    if (requestedSessionId?.success) {
      const summary = getSessionSummary(database, requestedSessionId.data);
      if (!summary) return response.status(404).json({ error: 'Sesión no encontrada.' });
      const lookup = buildLookup(database, requestedSessionId.data, summary.locationId, code);
      if (lookup.matches.length === 0) return response.status(404).json({ error: 'Bien no encontrado.', lookup });
      return response.json({ lookup, asset: lookup.asset, matches: lookup.matches, ambiguous: lookup.ambiguous });
    }
    const matches = findAssetsByCode(database, code);
    if (matches.length === 0) return response.status(404).json({ error: 'Bien no encontrado.' });
    return response.json({
      asset: matches.length === 1 ? matches[0] : null,
      matches,
      ambiguous: matches.length > 1,
    });
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
    const saved = saveObservation(database, sessionId.data, parsed.data);
    if (saved.error) return response.status(saved.status).json({ error: saved.error });
    return response.status(201).json({ observation: saved.observation });
  });

  router.post('/sessions/:id/pair', async (request, response, next) => {
    try {
      const sessionId = sessionIdSchema.safeParse(request.params.id);
      if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
      const session = database
        .prepare('SELECT status_code AS status FROM inventory_sessions WHERE id = ?')
        .get(sessionId.data);
      if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
      if (session.status !== 'open') return response.status(409).json({ error: 'La sesión está cerrada.' });

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      database.transaction(() => {
        database.prepare(`
          UPDATE session_pairings
          SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE inventory_session_id = ? AND revoked_at IS NULL
        `).run(sessionId.data);
        database.prepare(`
          INSERT INTO session_pairings (inventory_session_id, token_hash, expires_at)
          VALUES (?, ?, ?)
        `).run(sessionId.data, hashToken(token), expiresAt);
      })();

      const addresses = networkInfoProvider();
      const mobileUrls = addresses.map(({ address }) => (
        `http://${address}:3180/mobile?sessionId=${sessionId.data}&token=${encodeURIComponent(token)}`
      ));
      if (mobileUrls.length === 0) {
        mobileUrls.push(`http://localhost:3180/mobile?sessionId=${sessionId.data}&token=${encodeURIComponent(token)}`);
      }
      const mobileUrl = mobileUrls[0];
      const qrDataUrl = await QRCode.toDataURL(mobileUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
      return response.status(201).json({
        pairing: { sessionId: sessionId.data, token, expiresAt, mobileUrl, mobileUrls, qrDataUrl },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/sessions/:id/mobile', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    if (!sessionId.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const authorized = getPairing(database, sessionId.data, request);
    if (authorized.error) return response.status(authorized.status).json({ error: authorized.error });
    const summary = getSessionSummary(database, sessionId.data);
    const code = String(request.query.q ?? '').trim();
    const lookup = code ? buildLookup(database, sessionId.data, summary.locationId, code) : null;
    return response.json({
      session: {
        id: summary.id,
        status: summary.status,
        locationId: summary.locationId,
        direction: summary.direction,
        department: summary.department,
        section: summary.section,
      },
      summary,
      lookup,
    });
  });

  router.post('/sessions/:id/mobile-observations', (request, response) => {
    const sessionId = sessionIdSchema.safeParse(request.params.id);
    const parsed = mobileObservationSchema.safeParse(request.body);
    if (!sessionId.success || !parsed.success) {
      return response.status(400).json({ error: 'Observación móvil inválida.' });
    }
    const authorized = getPairing(database, sessionId.data, request);
    if (authorized.error) return response.status(authorized.status).json({ error: authorized.error });
    const summary = getSessionSummary(database, sessionId.data);
    const lookup = buildLookup(database, sessionId.data, summary.locationId, parsed.data.code);
    const selectedAsset = parsed.data.assetId
      ? lookup.matches.find(({ id }) => id === parsed.data.assetId)
      : lookup.asset;
    if (parsed.data.assetId && !selectedAsset) {
      return response.status(400).json({ error: 'El bien seleccionado no corresponde al código consultado.' });
    }
    if (lookup.ambiguous && !selectedAsset) {
      return response.status(409).json({
        error: 'El código escáner tiene múltiples coincidencias; seleccione el bien correcto.',
        matches: lookup.matches,
      });
    }
    if (selectedAsset?.alreadyObserved || (!selectedAsset && lookup.alreadyObserved)) {
      return response.status(409).json({ error: 'Este bien ya fue observado en la sesión.' });
    }
    const asset = selectedAsset;
    const classification = classifyAsset(asset, summary.locationId);
    const data = {
      assetId: asset?.id ?? null,
      provisionalCode: asset ? null : parsed.data.code,
      status: parsed.data.status,
      locationId: summary.locationId,
      observation: parsed.data.observation,
      observedAt: parsed.data.observedAt,
    };
    const validated = observationSchema.safeParse(data);
    if (!validated.success) return response.status(400).json({ error: 'Observación móvil inválida.' });
    if (classification === 'otra_ubicacion' && validated.data.status === 'verificado') {
      return response.status(409).json({ error: 'El bien pertenece a otra ubicación.' });
    }
    const saved = saveObservation(database, sessionId.data, validated.data);
    if (saved.error) return response.status(saved.status).json({ error: saved.error });
    return response.status(201).json({ observation: saved.observation, summary: getSessionSummary(database, sessionId.data) });
  });

  router.get('/sessions/:id/summary', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const summary = getSessionSummary(database, parsed.data);
    if (!summary) return response.status(404).json({ error: 'Sesión no encontrada.' });
    return response.json({ summary });
  });

  router.get('/sessions/:id/pending-assets', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const session = database.prepare(`
      SELECT location_id AS locationId FROM inventory_sessions WHERE id = ?
    `).get(parsed.data);
    if (!session) return response.status(404).json({ error: 'Sesión no encontrada.' });
    const assets = database.prepare(`
      ${assetProjection()}
      WHERE a.location_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM observations o
          WHERE o.inventory_session_id = ?
            AND o.asset_id = a.id
            AND o.status_code IN ('verificado', 'dato_distinto', 'no_ubicado')
        )
      ORDER BY a.asset_code
    `).all(session.locationId, parsed.data);
    return response.json({ assets });
  });

  router.post('/sessions/:id/close', (request, response) => {
    const parsed = sessionIdSchema.safeParse(request.params.id);
    if (!parsed.success) return response.status(400).json({ error: 'Id de sesión inválido.' });
    const currentSummary = getSessionSummary(database, parsed.data);
    if (!currentSummary) return response.status(404).json({ error: 'Sesión no encontrada.' });
    if (currentSummary.status === 'open' && currentSummary.pendientes > 0) {
      return response.status(409).json({
        error: `No puede cerrar la sesión: quedan ${currentSummary.pendientes} bienes pendientes de revisión.`,
        summary: currentSummary,
      });
    }
    const closed = database.prepare(`
      UPDATE inventory_sessions
      SET status_code = 'closed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status_code = 'open'
    `).run(parsed.data);
    database.prepare(`
      UPDATE session_pairings
      SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE inventory_session_id = ?
    `).run(parsed.data);
    return response.json({ summary: getSessionSummary(database, parsed.data) });
  });

  return router;
}
