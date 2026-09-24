import { isIP } from 'node:net';

export function normalizeIp(value: string): string {
  return value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
}

export function validateOrigins(origins: string[], production = false): string[] {
  if (!origins.length) throw new Error('ALLOWED_ORIGINS must contain at least one exact origin.');
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGINS contains an invalid origin.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      url.hostname.includes('*') ||
      (production && url.protocol !== 'https:')
    ) {
      throw new Error(
        'ALLOWED_ORIGINS requires exact canonical origins without paths, wildcards or credentials; production requires HTTPS.',
      );
    }
  }
  return [...new Set(origins)];
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number) {
  if (env[key] === undefined) return fallback;
  const value = env[key]!;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${key} must be a positive integer no greater than ${max}.`);
  }
  return Number(value);
}

export function serverConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && !env.ALLOWED_ORIGINS)
    throw new Error('Production requires explicit ALLOWED_ORIGINS.');
  const origins = validateOrigins(
    (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    production,
  );
  const trustedProxyIps = (env.TRUSTED_PROXY_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeIp);
  if (trustedProxyIps.some((ip) => !isIP(ip)))
    throw new Error(
      'TRUSTED_PROXY_IPS must contain exact IP addresses, without CIDRs or wildcards.',
    );
  return {
    port: integer(env, 'PORT', 8787, 65535),
    origins,
    trustedProxyIps,
    maxRooms: integer(env, 'MAX_ROOMS', 1000, 10000),
    maxConnections: integer(env, 'MAX_CONNECTIONS', 2200, 20000),
    maxConnectionsPerIp: integer(env, 'MAX_CONNECTIONS_PER_IP', 20, 20000),
    connectionsPerMinute: integer(env, 'CONNECTIONS_PER_MINUTE', 60, 10000),
  };
}
