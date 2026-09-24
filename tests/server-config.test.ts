import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { serverConfiguration, validateOrigins } from '../server/config';
import { clientAddress, ConnectionLimits, TokenBucket } from '../server/limits';

describe('production server configuration', () => {
  it('rejects missing, malformed and non-canonical origins', () => {
    expect(() => serverConfiguration({ NODE_ENV: 'production' })).toThrow();
    for (const origin of [
      'https://',
      'https://example.com/path',
      'https://example.com/',
      'https://*.example.com',
      'https://user:password@example.com',
      'null',
      'http://example.com',
    ]) {
      expect(() =>
        serverConfiguration({ NODE_ENV: 'production', ALLOWED_ORIGINS: origin }),
      ).toThrow();
    }
    expect(() => validateOrigins([])).toThrow();
    expect(
      serverConfiguration({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://irenex86.github.io' })
        .origins,
    ).toEqual(['https://irenex86.github.io']);
  });
  it('validates ports, resource limits and proxy addresses without echoing values', () => {
    for (const port of ['0', '-1', '65536', 'invalid', 'Infinity', '1.5', ''])
      expect(() => serverConfiguration({ PORT: port })).toThrow();
    expect(serverConfiguration({ PORT: '8080', MAX_CONNECTIONS_PER_IP: '30' })).toMatchObject({
      port: 8080,
      maxConnectionsPerIp: 30,
    });
    expect(() => serverConfiguration({ MAX_ROOMS: '999999' })).toThrow();
    expect(() => serverConfiguration({ TRUSTED_PROXY_IPS: '*' })).toThrow();
    expect(
      serverConfiguration({ TRUSTED_PROXY_IPS: '127.0.0.1,::ffff:192.0.2.1' }).trustedProxyIps,
    ).toEqual(['127.0.0.1', '192.0.2.1']);
  });
});

describe('bounded abuse controls', () => {
  it('enforces bursts, refill, source cardinality and idle expiry', () => {
    let time = 0;
    const now = () => time;
    const bucket = new TokenBucket(2, 1, now);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
    time = 1000;
    expect(bucket.take()).toBe(true);
    const limits = new ConnectionLimits(1, 2, 2, now);
    const release = limits.acquire('a')!;
    expect(limits.acquire('a')).toBeNull();
    release();
    release();
    expect(limits.acquire('a')).toBeNull(); // Opening a new socket cannot reset the attempt budget.
    limits.acquire('b')!();
    expect(limits.acquire('c')).toBeNull();
    expect(limits.size).toBe(2);
    time += 120001;
    limits.sweep();
    expect(limits.size).toBe(0);
    expect(limits.acquire('c')).not.toBeNull();
  });
  it('ignores forged forwarding headers and trusts only explicitly listed hops', () => {
    const request = (remoteAddress: string, forwarded: string) =>
      ({ socket: { remoteAddress }, headers: { 'x-forwarded-for': forwarded } }) as unknown as IncomingMessage;
    expect(clientAddress(request('192.0.2.10', '198.51.100.20'), new Set())).toBe('192.0.2.10');
    const trusted = new Set(['127.0.0.1', '192.0.2.2']);
    expect(clientAddress(request('::ffff:127.0.0.1', '203.0.113.5, 192.0.2.2'), trusted)).toBe(
      '203.0.113.5',
    );
    expect(clientAddress(request('127.0.0.1', '203.0.113.5, 198.51.100.10'), trusted)).toBe(
      '198.51.100.10',
    );
    expect(clientAddress(request('127.0.0.1', 'not-an-ip'), trusted)).toBe('127.0.0.1');
  });
});
