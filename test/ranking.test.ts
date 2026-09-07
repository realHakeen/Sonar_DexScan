import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { rankCandidates, splitByChain } from '../src/domain/ranking.js';
import type { TokenCandidate } from '../src/domain/types.js';

function make(p: Partial<TokenCandidate>): TokenCandidate {
  return {
    name: 'X',
    symbol: 'PEPE',
    networkSlug: 'ethereum',
    address: '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40),
    raw: {},
    ...p,
  };
}

test('流动性是第一权重，空池仿盘排在后面', () => {
  const real = make({ liquidityUsd: 5_000_000, volume24hUsd: 2_000_000, cmcId: 24478, traders24h: 8000 });
  const fake = make({ liquidityUsd: 120, volume24hUsd: 0 });
  const ranked = rankCandidates([fake, real], 'PEPE');
  assert.equal(ranked[0]?.candidate.address, real.address);
});

test('CMC 官方收录的合约被置顶', () => {
  const listed = make({ liquidityUsd: 100_000, officialVerified: true });
  const bigger = make({ liquidityUsd: 400_000 });
  const ranked = rankCandidates([bigger, listed], 'PEPE');
  assert.equal(ranked[0]?.candidate.officialVerified, true);
});

test('成交量高但交易人数极少会被判为刷量并扣分', () => {
  const wash = make({ liquidityUsd: 200_000, volume24hUsd: 10_000_000, traders24h: 3 });
  const scored = rankCandidates([wash], 'PEPE')[0];
  assert.ok((scored?.breakdown['washTradePenalty'] ?? 0) < 0);
});

test('同链同地址去重，保留流动性更高的一条', () => {
  const addr = '0x' + '1'.repeat(40);
  const ranked = rankCandidates(
    [make({ address: addr, liquidityUsd: 100 }), make({ address: addr, liquidityUsd: 900 })],
    'PEPE',
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.candidate.liquidityUsd, 900);
});

test('多链命中按流动性降序取主链，次链不丢弃', () => {
  const eth = make({ networkSlug: 'ethereum', liquidityUsd: 10_000 });
  const bnb = make({ networkSlug: 'bnb', liquidityUsd: 900_000 });
  const { primary, secondary } = splitByChain([eth, bnb]);
  assert.equal(primary?.networkSlug, 'bnb');
  assert.equal(secondary[0]?.networkSlug, 'ethereum');
});

test('CMC 排名进入打分：同等流动性下排名靠前者胜', () => {
  const ranked = rankCandidates(
    [make({ liquidityUsd: 100_000, cmcRank: 5000 }), make({ liquidityUsd: 100_000, cmcRank: 50 })],
    'X',
  );
  assert.equal(ranked[0]?.candidate.cmcRank, 50);
});

test('$AGI：精确 ticker 档内按流动性，DEX 上没交易的 CMC 收录币（Delysium $10K）排在 $900K 池的 AGI Frog 后面，AGIX 垫底', () => {
  const delysium = make({ symbol: 'AGI', name: 'Delysium', liquidityUsd: 10_000, volume24hUsd: 0, cmcId: 24007, cmcRank: 816, officialVerified: true });
  const frog = make({ symbol: 'AGI', name: 'AGI Frog', networkSlug: 'robinhood', liquidityUsd: 924_000, volume24hUsd: 889_000, traders24h: 400 });
  const agix = make({ symbol: 'AGIX', name: 'SingularityNET', liquidityUsd: 250_000, volume24hUsd: 7_000, traders24h: 55, cmcId: 2424, cmcRank: 4668, officialVerified: true });
  const ranked = rankCandidates([agix, delysium, frog], 'AGI');
  assert.deepEqual(ranked.map((r) => r.candidate.name), ['AGI Frog', 'Delysium', 'SingularityNET']);
});

test('原生币代理排在精确 ticker 之上（$HYPE：Hyperliquid via WHYPE 压过 Solana 上无 cid 的 HYPE）', () => {
  const sol = make({ symbol: 'HYPE', name: 'HYPE', networkSlug: 'solana', liquidityUsd: 16e6, volume24hUsd: 20e6, traders24h: 5000 });
  const proxy = make({ symbol: 'HYPE', name: 'Hyperliquid', networkSlug: 'hyperevm', liquidityUsd: 52e6, cmcId: 32196, cmcRank: 9, officialVerified: true, nativeProxy: 'WHYPE' });
  assert.equal(rankCandidates([sol, proxy], 'HYPE')[0]?.candidate.nativeProxy, 'WHYPE');
});

test('ticker 精确匹配是硬性第一档：流动性再大的前缀匹配也排在精确匹配后面', () => {
  const tiny = make({ symbol: 'AGI', name: 'AGI', liquidityUsd: 3_000 });
  const huge = make({ symbol: 'AGIX', name: 'SingularityNET', liquidityUsd: 50_000_000, volume24hUsd: 5_000_000, traders24h: 9000, cmcId: 2424, cmcRank: 200, officialVerified: true });
  const ranked = rankCandidates([huge, tiny], 'AGI');
  assert.equal(ranked[0]?.candidate.symbol, 'AGI');
  assert.equal(ranked[1]?.candidate.symbol, 'AGIX');
});

test('同 cid 的多链部署合并成一条：分数高的当代表，其余按流动性挂在 deployments（Delysium：BSC 出卡，Ethereum 做切链）', () => {
  const eth = make({ symbol: 'AGI', name: 'AGI Token', networkSlug: 'ethereum', liquidityUsd: 10_000, volume24hUsd: 0, cmcId: 24007, cmcRank: 816, officialVerified: true });
  const bnb = make({ symbol: 'AGI', name: 'AGI Token', networkSlug: 'bnb', liquidityUsd: 131_000, volume24hUsd: 7_000, traders24h: 30, cmcId: 24007 });
  const frog = make({ symbol: 'AGI', name: 'AGI Frog', networkSlug: 'robinhood', liquidityUsd: 924_000, volume24hUsd: 889_000, traders24h: 400 });
  const ranked = rankCandidates([eth, bnb, frog], 'AGI');
  assert.deepEqual(ranked.map((r) => `${r.candidate.name}@${r.candidate.networkSlug}`), ['AGI Frog@robinhood', 'AGI Token@bnb']);
  assert.deepEqual(ranked[1]?.deployments?.map((d) => d.networkSlug), ['ethereum']);
  // cid 0 / 无 cid 的不合并
  const a = make({ symbol: 'X', cmcId: 0, liquidityUsd: 100 });
  const b = make({ symbol: 'X', cmcId: 0, liquidityUsd: 200 });
  assert.equal(rankCandidates([a, b], 'X').length, 2);
});
