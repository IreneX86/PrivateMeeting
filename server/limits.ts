import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { normalizeIp } from './config.js';

// Never trust a forwarded address from a direct/unlisted caller. Walk a trusted
// proxy chain from right to left, stopping at the first untrusted hop.
export function clientAddress(request: IncomingMessage, trusted: ReadonlySet<string>): string {
  let address = normalizeIp(request.socket.remoteAddress ?? 'unknown');
  const forwarded = request.headers['x-forwarded-for'];
  if (!trusted.has(address) || typeof forwarded !== 'string' || forwarded.length > 1024)
    return address;
  const chain = forwarded.split(',').map((ip) => normalizeIp(ip.trim()));
  if (chain.length > 16 || chain.some((ip) => !isIP(ip))) return address;
  for (let index = chain.length - 1; index >= 0 && trusted.has(address); index--)
    address = chain[index];
  return address;
}

export class TokenBucket {
  private tokens: number;
  private updated: number;
  constructor(
    private capacity: number,
    private perSecond: number,
    private now = Date.now,
  ) {
    this.tokens = capacity;
    this.updated = now();
  }
  take(amount = 1): boolean {
    const time = this.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (Math.max(0, time - this.updated) * this.perSecond) / 1000,
    );
    this.updated = time;
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }
}

interface Source {
  attempts: TokenBucket;
  active: number;
  touched: number;
}
export class ConnectionLimits {
  private sources = new Map<string, Source>();
  constructor(
    private maxActive: number,
    private attemptsPerMinute: number,
    private maxSources = 10000,
    private now = Date.now,
  ) {}
  get size() {
    return this.sources.size;
  }
  acquire(address: string): (() => void) | null {
    let source = this.sources.get(address);
    if (!source) {
      if (this.sources.size >= this.maxSources) this.sweep();
      if (this.sources.size >= this.maxSources) return null;
      source = {
        attempts: new TokenBucket(this.attemptsPerMinute, this.attemptsPerMinute / 60, this.now),
        active: 0,
        touched: this.now(),
      };
      this.sources.set(address, source);
    }
    source.touched = this.now();
    if (!source.attempts.take() || source.active >= this.maxActive) return null;
    source.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        source.active--;
        source.touched = this.now();
      }
    };
  }
  sweep() {
    for (const [address, source] of this.sources) {
      if (source.active === 0 && this.now() - source.touched >= 120000)
        this.sources.delete(address);
    }
  }
  clear() {
    this.sources.clear();
  }
}
