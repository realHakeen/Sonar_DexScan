import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CmcGateway } from '../src/api/cmc/index.js';
import { AppError } from '../src/infra/errors.js';
import { ScanService } from '../src/services/scanService.js';

// Robinhood 链 Uniswap v4 池子（64 位 pool id）。DexScreener 显示 FLYBRAIN/GOOGL；
// CMC pairs/quotes 按合约里的 token0/token1 排，GOOGL 地址 0x2e08… 更小，被当成 base。
const POOL = '0x6f638b29e275cab8f584df0a4c6a045922217aed8747f2459eedb034abb31ac7';
const FLYBRAIN = '0x4Eb990547BCe4a982432CA88Cf5fae7EED1A2d35';
const GOOGL = '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3';

/** 反查出代币后会递归 scanByAddress → search；在这里把地址带出来，不用把整条 buildReport 链都 stub 掉。 */
class Scanned extends AppError {
  constructor(readonly address: string) {
    super(`scanned ${address}`, 'probe');
  }
}

function gateway(pairQuoteCalls: string[]): CmcGateway {
  return {
    dex: {
      search: async (q: string) => {
        throw new Scanned(q);
      },
      tokenDetail: async () => {
        throw new Error('probe down');
      },
      pairQuote: async (loc: { pairAddress: string }) => {
        pairQuoteCalls.push(loc.pairAddress);
        return { candidate: { address: GOOGL, networkSlug: 'robinhood', platform: 'Robinhood', symbol: 'GOOGL', name: 'GOOGL' }, security: undefined };
      },
    },
    core: {},
  } as unknown as CmcGateway;
}

function stubFetch(impl: (url: string) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => impl(String(url))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function scannedAddress(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof Scanned) return err.address;
    throw err;
  }
  throw new Error('scan did not reach search');
}

test('DexScreener 池子链接：base 代币以 DexScreener 为准，不碰 CMC pairs/quotes', async () => {
  const calls: string[] = [];
  const urls: string[] = [];
  const restore = stubFetch(async (url) => {
    urls.push(url);
    const body = {
      pairs: [
        {
          chainId: 'robinhood',
          pairAddress: POOL,
          baseToken: { address: FLYBRAIN, symbol: 'FLYBRAIN' },
          quoteToken: { address: GOOGL, symbol: 'GOOGL' },
          liquidity: { usd: 444571 },
        },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const svc = new ScanService(gateway(calls));
    const scanned = await scannedAddress(() => svc.scanByAddress(POOL, { chainSlug: 'robinhood', preferPair: true }));
    assert.equal(scanned, FLYBRAIN, '扫的是 DexScreener 的 base，不是 CMC 的 token0');
    assert.deepEqual(calls, [], 'DexScreener 命中时不花 CMC credit');
    assert.equal(urls.length, 1);
    assert.ok(urls[0]!.endsWith(`/pairs/robinhood/${POOL}`), urls[0]);
  } finally {
    restore();
  }
});

test('DexScreener 查不到或网络错误时退到 CMC pairs/quotes（base 可能是报价币那边）', async () => {
  const modes: Array<[string, () => Promise<Response>]> = [
    ['404', async () => new Response('{}', { status: 404 })],
    ['空 pairs', async () => new Response(JSON.stringify({ pairs: [] }), { status: 200 })],
    ['网络错误', async () => { throw new TypeError('fetch failed'); }],
  ];
  for (const [label, impl] of modes) {
    const calls: string[] = [];
    const restore = stubFetch(impl);
    try {
      const svc = new ScanService(gateway(calls));
      const scanned = await scannedAddress(() => svc.scanByAddress(POOL, { chainSlug: 'robinhood', preferPair: true }));
      assert.equal(scanned.toLowerCase(), GOOGL, `${label}：退到 CMC 的 base`);
      assert.deepEqual(calls, [POOL], `${label}：CMC pairs/quotes 只调一次`);
    } finally {
      restore();
    }
  }
});

test('DexScreener 把池子本身当 base 时不递归，照常退到 CMC', async () => {
  const calls: string[] = [];
  const restore = stubFetch(async () =>
    new Response(JSON.stringify({ pairs: [{ chainId: 'robinhood', pairAddress: POOL, baseToken: { address: POOL, symbol: 'LP' }, liquidity: { usd: 1 } }] }), { status: 200 }),
  );
  try {
    const svc = new ScanService(gateway(calls));
    const scanned = await scannedAddress(() => svc.scanByAddress(POOL, { chainSlug: 'robinhood', preferPair: true }));
    assert.equal(scanned.toLowerCase(), GOOGL);
    assert.deepEqual(calls, [POOL]);
  } finally {
    restore();
  }
});
