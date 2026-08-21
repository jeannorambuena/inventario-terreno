export function createConsultationState() {
  return {
    locations: [],
    overview: null,
    locationId: null,
    assets: [],
    observations: [],
    rows: [],
    filter: 'all',
    query: '',
    loading: false,
  };
}

export function normalizeConsultationText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .trim();
}

export function flattenOverviewSections(overview) {
  return (overview?.directions ?? [])
    .flatMap(({ departments = [] }) => departments)
    .flatMap(({ sections = [] }) => sections);
}

export function findOverviewSection(overview, locationId) {
  return flattenOverviewSections(overview)
    .find((section) => Number(section.locationId) === Number(locationId)) ?? null;
}

export function consultationLocationLabel(location) {
  if (!location) return 'Sin ubicación seleccionada';
  return [location.direction, location.department, location.section]
    .filter(Boolean)
    .join(' · ');
}

export function consultationSectionState(state) {
  return {
    sin_iniciar: 'Sin iniciar',
    en_proceso: 'En proceso',
    finalizada: 'Finalizada',
  }[state] ?? 'Sin iniciar';
}

export function consultationAssetStatus(status) {
  return {
    verificado: { key: 'conforming', label: 'Conforme' },
    dato_distinto: { key: 'incident', label: 'Incidencia' },
    no_ubicado: { key: 'not-found', label: 'No encontrado' },
    otra_ubicacion: { key: 'other-location', label: 'Otra ubicación' },
    desconocido: { key: 'other', label: 'Otro' },
  }[status] ?? { key: 'pending', label: 'Pendiente' };
}

export function buildConsultationRows(assets, observations = [], section = null) {
  const observationByAsset = new Map(
    observations
      .filter(({ assetId }) => assetId != null)
      .map((observation) => [Number(observation.assetId), observation]),
  );
  return assets.map((asset) => {
    const observation = observationByAsset.get(Number(asset.id));
    const status = consultationAssetStatus(observation?.status);
    return {
      ...asset,
      consultationStatus: status.key,
      consultationStatusLabel: status.label,
      sectionState: section?.state ?? 'sin_iniciar',
      sessionId: section?.sessionId ?? null,
    };
  });
}

export function filterConsultationRows(rows, { query = '', filter = 'all' } = {}) {
  const normalizedQuery = normalizeConsultationText(query);
  return rows.filter((row) => {
    const matchesFilter = filter === 'all'
      || (filter === 'pending' && row.consultationStatus === 'pending')
      || (filter === 'reviewed' && row.consultationStatus !== 'pending')
      || (filter === 'incidents' && !['pending', 'conforming'].includes(row.consultationStatus));
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;
    return [row.assetCode, row.scannerCode, row.name, row.description, row.serialNumber]
      .some((value) => normalizeConsultationText(value).includes(normalizedQuery));
  });
}
