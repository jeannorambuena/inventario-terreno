import { networkInterfaces } from 'node:os';

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

export function getPrivateIPv4Addresses() {
  const addresses = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address)) {
        addresses.push({ interface: interfaceName, address: entry.address });
      }
    }
  }
  return addresses.sort((left, right) => left.address.localeCompare(right.address));
}
