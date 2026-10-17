import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);

  if ([a, b].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // 127.0.0.0/8
    (a === 169 && b === 254) ||      // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||      // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224                         // multicast/reserved
  );
}

export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  return (
    normalized === '::1' ||          // loopback
    normalized === '::' ||           // unspecified
    normalized.startsWith('fe80:') || // link-local
    normalized.startsWith('fc') ||   // unique local fc00::/7
    normalized.startsWith('fd') ||   // unique local fd00::/7
    normalized.startsWith('ff')      // multicast
  );
}

// Expands a valid IPv6 address (optionally with a dotted-quad tail) into 8 hextets.
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0];

  const dotted = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[2].split('.').map(Number);
    if (octets.some((n) => n > 255)) return null;
    addr =
      dotted[1] +
      ((octets[0] << 8) | octets[1]).toString(16) +
      ':' +
      ((octets[2] << 8) | octets[3]).toString(16);
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string) =>
    part ? part.split(':').map((h) => parseInt(h, 16)) : [];
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;

  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;

  const hextets = [...head, ...new Array(fill).fill(0), ...tail];
  if (hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function hextetsToIPv4(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function isBlockedIPv6Hextets(h: number[]): boolean {
  const zeros = (from: number, to: number) =>
    h.slice(from, to).every((n) => n === 0);

  // IPv4-mapped ::ffff:0:0/96 (dotted or hex form)
  if (zeros(0, 5) && h[5] === 0xffff) {
    return isBlockedIPv4(hextetsToIPv4(h[6], h[7]));
  }
  // IPv4-translated ::ffff:0:0:0/96
  if (zeros(0, 4) && h[4] === 0xffff && h[5] === 0) {
    return isBlockedIPv4(hextetsToIPv4(h[6], h[7]));
  }
  // IPv4-compatible ::/96 (deprecated; also covers :: and ::1)
  if (zeros(0, 6)) {
    return true;
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) {
    return isBlockedIPv4(hextetsToIPv4(h[6], h[7]));
  }
  // NAT64 local-use 64:ff9b:1::/48
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) {
    return true;
  }
  // 6to4 2002::/16 — embedded IPv4 in bits 16-47
  if (h[0] === 0x2002) {
    return isBlockedIPv4(hextetsToIPv4(h[1], h[2]));
  }

  return (
    (h[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (h[0] & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (h[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (h[0] & 0xff00) === 0xff00 // multicast ff00::/8
  );
}

export function isBlockedIp(ip: string): boolean {
  try {
    if (typeof ip !== 'string') return true;
    const candidate = ip.trim().replace(/^\[|\]$/g, '');
    const version = net.isIP(candidate);
    if (version === 4) {
      return isBlockedIPv4(candidate);
    }
    if (version === 6) {
      const hextets = expandIPv6(candidate);
      if (!hextets) return true;
      return isBlockedIPv6(candidate) || isBlockedIPv6Hextets(hextets);
    }
    return true;
  } catch {
    return true;
  }
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (hostname === 'localhost') {
    return false;
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return !isBlockedIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records.length) {
      return false;
    }

    for (const record of records) {
      if (isBlockedIp(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}