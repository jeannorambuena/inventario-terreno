import { networkInterfaces } from 'node:os';

const virtualInterfacePattern = /wsl|vethernet|hyper[ -]?v|docker|vmware|virtualbox|loopback|tailscale|\bvpn\b|t[uú]nel|tunnel|virtual/i;
const wifiInterfacePattern = /wi-?fi|wlan/i;
const ethernetInterfacePattern = /ethernet/i;

function normalizeAddress(address = '') {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function isPrivateIPv4(address) {
  const parts = normalizeAddress(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function isLocalClient(address = '') {
  const normalized = normalizeAddress(address);
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost'
    || isPrivateIPv4(normalized);
}

function interfacePriority(interfaceName) {
  if (wifiInterfacePattern.test(interfaceName)) return 0;
  if (ethernetInterfacePattern.test(interfaceName)) return 1;
  return 2;
}

function normalizeMobileBaseUrl(value) {
  const configured = String(value ?? '').trim();
  if (!configured) return null;
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('MOBILE_BASE_URL debe ser una URL HTTP o HTTPS válida.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('MOBILE_BASE_URL debe usar HTTP/HTTPS y no puede contener credenciales.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('MOBILE_BASE_URL debe contener solo esquema, host y puerto.');
  }
  return parsed.origin;
}

export function classifyNetworkInterfaces(interfaces = {}) {
  const candidates = [];
  const excluded = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    const virtual = virtualInterfacePattern.test(interfaceName);
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIPv4(entry.address)) continue;
      if (virtual) {
        excluded.push({ interface: interfaceName, address: entry.address, reason: 'virtual' });
        continue;
      }
      const priority = interfacePriority(interfaceName);
      if (priority > 1) {
        excluded.push({ interface: interfaceName, address: entry.address, reason: 'not-confidently-physical' });
        continue;
      }
      candidates.push({
        interface: interfaceName,
        address: entry.address,
        type: priority === 0 ? 'wifi' : 'ethernet',
        priority,
      });
    }
  }

  candidates.sort((left, right) => (
    left.priority - right.priority
    || left.interface.localeCompare(right.interface, 'es', { sensitivity: 'base' })
    || left.address.localeCompare(right.address, undefined, { numeric: true })
  ));

  return {
    candidates: candidates.map((candidate, index) => ({
      interface: candidate.interface,
      address: candidate.address,
      type: candidate.type,
      selected: index === 0,
    })),
    excluded,
  };
}

export function getMobileNetworkInfo({
  interfaces = networkInterfaces(),
  mobileBaseUrl = process.env.MOBILE_BASE_URL,
} = {}) {
  const configuredBaseUrl = normalizeMobileBaseUrl(mobileBaseUrl);
  if (configuredBaseUrl) {
    return {
      source: 'MOBILE_BASE_URL',
      baseUrl: configuredBaseUrl,
      candidates: [],
      selected: { interface: 'MOBILE_BASE_URL', address: new URL(configuredBaseUrl).hostname },
      warning: null,
    };
  }

  const classified = classifyNetworkInterfaces(interfaces);
  const selected = classified.candidates.find(({ selected: isSelected }) => isSelected) ?? null;
  return {
    source: selected ? 'physical-interface' : 'localhost-only',
    baseUrl: null,
    candidates: classified.candidates,
    selected,
    warning: selected
      ? null
      : 'No se encontró una interfaz física confiable. Configure MOBILE_BASE_URL; localhost continúa disponible.',
  };
}

export function getPrivateIPv4Addresses() {
  return getMobileNetworkInfo().candidates;
}
