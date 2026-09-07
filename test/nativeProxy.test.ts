import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CoinIndex } from '../src/domain/coinIndex.js';
import { attachCoin, isNativeCoin, proxyNativeCoin, representsNative } from '../src/domain/nativeProxy.js';
import type { TokenCandidate } from '../src/domain/types.js';

function make(p: Partial<TokenCandidate>): TokenCandidate {
  return { name: 'X', symbol: 'X', networkSlug: 'near', address: 'x.near', raw: {}, ...p };
}

function index(): CoinIndex {
  const idx = new CoinIndex();
  idx.load([
    { id: 6535, name: 'NEAR Protocol', symbol: 'NEAR', slug: 'near-protocol', rank: 30, platform: null },
    { id: 22974, name: 'Bittensor', symbol: 'TAO', slug: 'bittensor', rank: 31, platform: { id: 258, name: 'Bittensor', symbol: 'TAO', slug: 'bittensor', token_address: '0' } },
    { id: 1, name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', rank: 1, platform: null },
    { id: 3717, name: 'Wrapped Bitcoin', symbol: 'WBTC', slug: 'wrapped-bitcoin', rank: 15, platform: { id: 1, name: 'Ethereum', symbol: 'ETH', slug: 'ethereum', token_address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' } },
    { id: 24007, name: 'Delysium', symbol: 'AGI', slug: 'delysium', rank: 816, platform: { id: 1, name: 'Ethereum', symbol: 'ETH', slug: 'ethereum', token_address: '0x7da2641000cbb407c329310c461b2cb9c70c3046' } },
  ] as never);
  return idx;
}

test('原生币判定：platform 为空、token_address 是 "0" 或 Hyperliquid 的 32 位资产 id；有真合约的不算', () => {
  const idx = index();
  assert.equal(isNativeCoin(idx.byCmcId(6535)!), true);
  assert.equal(isNativeCoin(idx.byCmcId(22974)!), true);
  assert.equal(isNativeCoin({ cmcId: 32196, name: 'Hyperliquid', symbol: 'HYPE', slug: 'hyperliquid', rank: 9, networkSlug: 'hyperliquid', address: '0x0d01dc56dcaaca66ad901c959b4011ec' }), true);
  assert.equal(isNativeCoin(idx.byCmcId(24007)!), false);
});

test('$NEAR：流动性最高的 Wrapped NEAR 换成 NEAR Protocol 身份，其余候选不动', () => {
  const idx = index();
  const wnear = make({ symbol: 'WNEAR', name: 'Wrapped NEAR fungible token', address: 'wrap.near', liquidityUsd: 279e6, cmcId: 11808, listingMarketCapUsd: 1.7e6, listedAt: 1, cexListings: [] });
  const bridged = make({ symbol: 'NEAR', name: 'NEAR', networkSlug: 'ethereum', address: '0x85f1', liquidityUsd: 540e3, cmcId: 6535 });
  const linear = make({ symbol: 'LINEAR', name: 'LiNEAR', address: 'linear-protocol.near', liquidityUsd: 4.6e6, cmcId: 19757 });
  const out = proxyNativeCoin([linear, wnear, bridged], idx.byCmcId(6535)!)!;
  // 币层是 NEAR Protocol，部署层仍是 WNEAR / wrap.near
  assert.deepEqual(out.proxy.coin, { cmcId: 6535, symbol: 'NEAR', name: 'NEAR Protocol', rank: 30 });
  assert.equal(out.proxy.symbol, 'WNEAR');
  assert.equal(out.proxy.name, 'Wrapped NEAR fungible token');
  assert.equal(out.proxy.cmcId, 6535);
  assert.equal(out.proxy.cmcRank, 30);
  assert.equal(out.proxy.officialVerified, true);
  assert.equal(out.proxy.address, 'wrap.near');
  assert.equal(out.proxy.listedAt, 1, '部署层的上线时长保留');
  // 封装代币自己的收录市值 / 上所列表不带过去
  assert.equal(out.proxy.listingMarketCapUsd, undefined);
  assert.equal(out.proxy.cexListings, undefined);
  assert.equal(out.pool.length, 3);
  assert.equal(out.pool[0], linear);
  assert.equal(out.pool[1], out.proxy);
  assert.equal(out.pool[2], bridged);
});

test('挂在原生币 cid 下的桥接代币也算代表（Solana 上的 TAO）', () => {
  const idx = index();
  const tao = make({ symbol: 'TAO', name: 'Bittensor', networkSlug: 'solana', address: 'taoC6', cmcId: 22974 });
  assert.equal(representsNative(tao, idx.byCmcId(22974)!), true);
  const taot = make({ symbol: 'TAOT', name: 'TAOT', cmcId: 40819 });
  assert.equal(representsNative(taot, idx.byCmcId(22974)!), false);
});

// 用假设的 WBTC #15 演示规则：封装代币自己有像样排名就是独立资产（2026-09 实际 map 里 WBTC 已是 #7965）
test('封装代币自己排名靠前时是独立资产，不代理成原生币；找不到代表时返回 undefined', () => {
  const idx = index();
  const wbtc = make({ symbol: 'WBTC', name: 'Wrapped Bitcoin', networkSlug: 'ethereum', address: '0x2260', cmcId: 3717, cmcRank: 15, officialVerified: true });
  assert.equal(representsNative(wbtc, idx.byCmcId(1)!), false);
  assert.equal(proxyNativeCoin([wbtc], idx.byCmcId(1)!), undefined);
  // 候选没带 cmcRank 时按合约查索引
  const bare = make({ symbol: 'WBTC', name: 'Wrapped Bitcoin', networkSlug: 'ethereum', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' });
  assert.equal(representsNative(bare, idx.byCmcId(1)!, idx), false);
  assert.equal(representsNative(bare, idx.byCmcId(1)!), true, '没有索引时只能靠候选自带的 cmcRank');
});

test('按钮重扫：拿原生币 cid 给封装币候选套身份（Refresh 后仍是 NEAR Protocol）', () => {
  const idx = index();
  const wnear = make({ symbol: 'WNEAR', name: 'Wrapped NEAR fungible token', address: 'wrap.near', cmcId: 11808, listedAt: 1 });
  const p = attachCoin(wnear, idx.byCmcId(6535)!);
  assert.equal(p.coin?.symbol, 'NEAR');
  assert.equal(p.symbol, 'WNEAR');
  assert.equal(p.cmcId, 6535);
});
