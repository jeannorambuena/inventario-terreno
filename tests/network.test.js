import { describe, expect, test } from 'vitest';

import { getMobileNetworkInfo } from '../src/network.js';

const ipv4 = (address) => ({ address, family: 'IPv4', internal: false });

describe('mobile LAN interface selection', () => {
  test('Wi-Fi 192.168.1.74 wins over vEthernet WSL 172.29.112.1', () => {
    const result = getMobileNetworkInfo({
      interfaces: {
        'vEthernet (WSL)': [ipv4('172.29.112.1')],
        'Wi-Fi': [ipv4('192.168.1.74')],
      },
      mobileBaseUrl: '',
    });
    expect(result.selected).toMatchObject({ interface: 'Wi-Fi', address: '192.168.1.74' });
    expect(result.candidates.map(({ address }) => address)).not.toContain('172.29.112.1');
  });

  test('physical Ethernet wins over Docker', () => {
    const result = getMobileNetworkInfo({
      interfaces: {
        'Docker Desktop': [ipv4('172.18.0.1')],
        Ethernet: [ipv4('192.168.20.8')],
      },
      mobileBaseUrl: '',
    });
    expect(result.selected).toMatchObject({ interface: 'Ethernet', address: '192.168.20.8' });
  });

  test.each([
    ['Ethernet', '10.25.8.4'],
    ['WLAN', '172.20.14.9'],
  ])('accepts physical interface %s in private network %s', (interfaceName, address) => {
    const result = getMobileNetworkInfo({
      interfaces: { [interfaceName]: [ipv4(address)] },
      mobileBaseUrl: '',
    });
    expect(result.selected).toMatchObject({ interface: interfaceName, address });
  });

  test('MOBILE_BASE_URL has absolute priority over detected interfaces', () => {
    const result = getMobileNetworkInfo({
      interfaces: { 'Wi-Fi': [ipv4('192.168.1.74')] },
      mobileBaseUrl: 'http://10.50.0.7:3180',
    });
    expect(result).toMatchObject({
      source: 'MOBILE_BASE_URL',
      baseUrl: 'http://10.50.0.7:3180',
      candidates: [],
    });
  });

  test('virtual-only interfaces do not produce an incorrect LAN candidate', () => {
    const result = getMobileNetworkInfo({
      interfaces: {
        'vEthernet (WSL)': [ipv4('172.29.112.1')],
        'Hyper-V Virtual Ethernet Adapter': [ipv4('172.21.0.1')],
      },
      mobileBaseUrl: '',
    });
    expect(result.source).toBe('localhost-only');
    expect(result.selected).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.warning).toContain('MOBILE_BASE_URL');
  });
});
