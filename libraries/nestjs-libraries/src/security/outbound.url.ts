import dns from 'node:dns/promises';
import net from 'node:net';
import { isBlockedIp } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

export class UnsafeOutboundUrlError extends Error {
  constructor(message = 'Blocked outbound URL') {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

export class TooManyRedirectsError extends Error {
  constructor(message = 'Too many redirects') {
    super(message);
    this.name = 'TooManyRedirectsError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

// Escape hatch for self-hosted instances on a private network. Read on every
// call so the env can change at runtime (and in tests).
function isPrivateHostAllowed(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return (process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST || '')
    .split(',')
    .map((h) => normalizeHost(h.trim()))
    .filter(Boolean)
    .includes(host);
}

export async function assertSafeOutboundUrl(
  input: string,
  opts: { allowHttp?: boolean } = {}
): Promise<URL> {
  if (typeof input !== 'string' || !input.trim()) {
    throw new UnsafeOutboundUrlError('Empty URL');
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UnsafeOutboundUrlError('Invalid URL');
  }

  if (
    url.protocol !== 'https:' &&
    !(opts.allowHttp && url.protocol === 'http:')
  ) {
    throw new UnsafeOutboundUrlError('Unsupported protocol');
  }

  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('Credentials in URL are not allowed');
  }

  const host = normalizeHost(url.hostname);
  if (!host) {
    throw new UnsafeOutboundUrlError('Missing host');
  }

  if (isPrivateHostAllowed(host)) {
    return url;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeOutboundUrlError('Blocked host');
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new UnsafeOutboundUrlError('Blocked address');
    }
    return url;
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new UnsafeOutboundUrlError('Host lookup failed');
  }

  if (!records?.length || records.some((r) => isBlockedIp(r.address))) {
    throw new UnsafeOutboundUrlError('Blocked address');
  }

  return url;
}

export async function safeFetch(
  input: string,
  init: RequestInit = {},
  opts: { allowHttp?: boolean; maxRedirects?: number } = {}
): Promise<Response> {
  const { allowHttp = false, maxRedirects = 5 } = opts;
  let url = await assertSafeOutboundUrl(input, { allowHttp });

  if (init.redirect === 'manual' || init.redirect === 'error') {
    return fetch(url.toString(), init);
  }

  let method = (init.method || 'GET').toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);

  for (let hop = 0; ; hop++) {
    const response = await fetch(url.toString(), {
      ...init,
      method,
      body,
      headers: new Headers(headers),
      redirect: 'manual',
    });

    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);

    if (hop >= maxRedirects) {
      throw new TooManyRedirectsError();
    }

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new UnsafeOutboundUrlError('Invalid redirect target');
    }
    next = await assertSafeOutboundUrl(next.toString(), { allowHttp });

    if (
      (response.status === 303 && method !== 'GET' && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) &&
        method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.delete('content-language');
      headers.delete('content-location');
    }

    if (next.origin !== url.origin) {
      headers.delete('authorization');
      headers.delete('proxy-authorization');
      headers.delete('cookie');
    }

    url = next;
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: any,
  family?: number
) => void;

// Callback-style lookup for node http/https `lookup` option and axios `lookup`
// config. Note: node skips `lookup` for IP literals, so callers must still
// validate the URL itself (see assertSafeOutboundUrl).
// Loosely typed so it is assignable to both node's and axios' lookup types.
export function safeLookup(
  hostname: string,
  options: any,
  callback?: (...args: any[]) => void
): void {
  let opts: { family?: number | string; all?: boolean };
  let cb: LookupCallback;
  if (typeof options === 'function') {
    opts = {};
    cb = options;
  } else if (typeof options === 'number') {
    opts = { family: options };
    cb = callback!;
  } else {
    opts = options || {};
    cb = callback!;
  }

  const family =
    opts.family === 4 || opts.family === 'IPv4'
      ? 4
      : opts.family === 6 || opts.family === 'IPv6'
      ? 6
      : 0;

  dns.lookup(hostname, { family, all: true }).then(
    (addresses) => {
      if (!addresses?.length) {
        const err: NodeJS.ErrnoException = new Error(
          `getaddrinfo ENOTFOUND ${hostname}`
        );
        err.code = 'ENOTFOUND';
        return cb(err);
      }

      if (
        !isPrivateHostAllowed(hostname) &&
        addresses.some((a) => isBlockedIp(a.address))
      ) {
        const err: NodeJS.ErrnoException = new Error(
          `Blocked outbound connection to ${hostname}`
        );
        err.code = 'EUNSAFEHOST';
        return cb(err);
      }

      if (opts.all) {
        return cb(null, addresses);
      }
      return cb(null, addresses[0].address, addresses[0].family);
    },
    (err) => cb(err)
  );
}
