const mockLookup = jest.fn();

jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: { lookup: (...args: any[]) => mockLookup(...args) },
  lookup: (...args: any[]) => mockLookup(...args),
}));
jest.mock('dns/promises', () => ({
  __esModule: true,
  default: { lookup: (...args: any[]) => mockLookup(...args) },
  lookup: (...args: any[]) => mockLookup(...args),
}));

import { isBlockedIp } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import {
  assertSafeOutboundUrl,
  safeFetch,
  safeLookup,
  TooManyRedirectsError,
  UnsafeOutboundUrlError,
} from './outbound.url';

const publicRecord = [{ address: '93.184.216.34', family: 4 }];

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:0a00:0001',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::127.0.0.1',
    '2002:7f00:0001::',
    'fec0::1',
    'fe80::1',
    'fd00::1',
    'ff02::1',
    'not-an-ip',
    '',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '2002:0808:0808::'])(
    'allows %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    }
  );

  it('does not throw on odd input', () => {
    expect(isBlockedIp(undefined as any)).toBe(true);
    expect(isBlockedIp('1:2:3:4:5:6:7:8:9')).toBe(true);
  });
});

describe('assertSafeOutboundUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue(publicRecord);
    delete process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST;
  });

  it('accepts a public https url', async () => {
    const url = await assertSafeOutboundUrl('https://example.com/a');
    expect(url.hostname).toBe('example.com');
  });

  it.each([
    'ftp://example.com/file',
    'http://example.com/',
    'https://user:pass@example.com/',
    'https://localhost/',
    'https://foo.localhost/',
    'https://localhost./',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://[::1]/',
    'https://[::ffff:7f00:1]/',
    'not a url',
  ])('rejects %s', async (input) => {
    await expect(assertSafeOutboundUrl(input)).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError
    );
  });

  it('allows http only with allowHttp', async () => {
    await expect(
      assertSafeOutboundUrl('http://example.com/', { allowHttp: true })
    ).resolves.toBeInstanceOf(URL);
  });

  it('rejects hostnames resolving to a private address', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    await expect(
      assertSafeOutboundUrl('https://internal.example.com/')
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('rejects when lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      assertSafeOutboundUrl('https://nope.example.com/')
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('allowlisted hosts skip the private-ip check but not scheme rules', async () => {
    process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST = 'other.test, Mastodon.LAN';
    mockLookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }]);
    await expect(
      assertSafeOutboundUrl('http://mastodon.lan/', { allowHttp: true })
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeOutboundUrl('http://mastodon.lan/')
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    await expect(
      assertSafeOutboundUrl('https://not-listed.lan/')
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });
});

describe('safeFetch', () => {
  let fetchSpy: jest.SpyInstance;

  const redirect = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockImplementation(async (host: string) =>
      host === 'evil.example.com'
        ? [{ address: '169.254.169.254', family: 4 }]
        : publicRecord
    );
    delete process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST;
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected network call'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects the initial url without calling fetch', async () => {
    await expect(safeFetch('https://127.0.0.1/')).rejects.toBeInstanceOf(
      UnsafeOutboundUrlError
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows safe redirects with redirect: manual', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirect('/next'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await safeFetch('https://a.example.com/start');
    expect(await res.text()).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://a.example.com/next');
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('manual');
  });

  it('re-validates every redirect hop', async () => {
    fetchSpy.mockResolvedValueOnce(redirect('https://evil.example.com/meta'));
    await expect(
      safeFetch('https://a.example.com/start')
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks redirects to literal private IPs', async () => {
    fetchSpy.mockResolvedValueOnce(redirect('http://169.254.169.254/'));
    await expect(
      safeFetch('https://a.example.com/', {}, { allowHttp: true })
    ).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('drops Authorization and Cookie on cross-origin redirect', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirect('/same'))
      .mockResolvedValueOnce(redirect('https://b.example.com/other', 307))
      .mockResolvedValueOnce(new Response('ok'));

    await safeFetch('https://a.example.com/', {
      headers: { Authorization: 'Bearer x', Cookie: 'c=1', 'X-Keep': '1' },
    });

    const sameOrigin = fetchSpy.mock.calls[1][1].headers as Headers;
    expect(sameOrigin.get('authorization')).toBe('Bearer x');

    const crossOrigin = fetchSpy.mock.calls[2][1].headers as Headers;
    expect(crossOrigin.get('authorization')).toBeNull();
    expect(crossOrigin.get('cookie')).toBeNull();
    expect(crossOrigin.get('x-keep')).toBe('1');
  });

  it('switches POST to GET on 303 and drops the body', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirect('/done', 303))
      .mockResolvedValueOnce(new Response('ok'));

    await safeFetch('https://a.example.com/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    const second = fetchSpy.mock.calls[1][1];
    expect(second.method).toBe('GET');
    expect(second.body).toBeUndefined();
    expect((second.headers as Headers).get('content-type')).toBeNull();
  });

  it('keeps method and body on 307', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirect('/again', 307))
      .mockResolvedValueOnce(new Response('ok'));

    await safeFetch('https://a.example.com/', { method: 'POST', body: '{}' });
    expect(fetchSpy.mock.calls[1][1].method).toBe('POST');
    expect(fetchSpy.mock.calls[1][1].body).toBe('{}');
  });

  it('throws on too many redirects', async () => {
    fetchSpy.mockImplementation(async () => redirect('/loop'));
    await expect(
      safeFetch('https://a.example.com/', {}, { maxRedirects: 2 })
    ).rejects.toBeInstanceOf(TooManyRedirectsError);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('passes through when caller asked for redirect: manual', async () => {
    fetchSpy.mockResolvedValueOnce(redirect('https://evil.example.com/'));
    const res = await safeFetch('https://a.example.com/', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('safeLookup', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    delete process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST;
  });

  const run = (host: string, options: any) =>
    new Promise<{ err: any; address: any; family: any }>((resolve) =>
      safeLookup(host, options, (err, address, family) =>
        resolve({ err, address, family })
      )
    );

  it('returns a single address when all is false', async () => {
    mockLookup.mockResolvedValue(publicRecord);
    const { err, address, family } = await run('example.com', {});
    expect(err).toBeNull();
    expect(address).toBe('93.184.216.34');
    expect(family).toBe(4);
  });

  it('returns all addresses when all is true', async () => {
    mockLookup.mockResolvedValue(publicRecord);
    const { address } = await run('example.com', { all: true });
    expect(address).toEqual(publicRecord);
  });

  it('errors with EUNSAFEHOST for private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    const { err } = await run('internal.example.com', { all: true });
    expect(err.code).toBe('EUNSAFEHOST');
  });

  it('respects the allowlist', async () => {
    process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST = 'internal.example.com';
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    const { err, address } = await run('internal.example.com', {});
    expect(err).toBeNull();
    expect(address).toBe('10.0.0.1');
  });
});
