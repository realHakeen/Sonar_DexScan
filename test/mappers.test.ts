import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  asArray,
  toHolderEntry,
  toHoldersOverview,
  toPoolInfo,
  toSecurityDetail,
  toSecurityScan,
  toTagDistribution,
  toTokenCandidate,
  toTokenDetail,
} from '../src/api/cmc/mappers.js';

// 下列样例均取自 2026-09-02 真实响应（截断）

test('search.tks 记录：plt 显示名归一、pu 字符串、pc24h 小数×100、时间戳毫秒字符串', () => {
  const c = toTokenCandidate({
    pltId: 14, plt: 'BSC', plti: 1839, n: 'PancakeSwap Token', s: 'Cake',
    addr: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    pt: '1600753669000', lt: '1750693872000', w: 'https://pancakeswap.finance/', x: 'https://twitter.com/pancakeswap',
    pu: '1.817340627565386604630462896696484', pc24h: -0.0249, dec: 18, tsup: '1', fpct: '1600753669000',
    v24h: 100, mc: 9511096175, liq: 4561980, ts: '1', lf: 1, cid: 7186, ut24h: '3723', ecs: 0, ssc: 2,
  });
  assert.ok(c);
  assert.equal(c.networkSlug, 'bnb');
  assert.equal(c.platform, 'BSC');
  assert.equal(c.networkId, 14);
  assert.equal(c.symbol, 'CAKE');
  assert.ok(Math.abs(c.priceUsd! - 1.8173406) < 1e-6);
  assert.ok(Math.abs(c.priceChange24hPct! - -2.49) < 1e-9);
  assert.equal(c.fdvUsd, 9511096175);
  assert.equal(c.traders24h, 3723);
  assert.equal(c.listedAt, 1600753669000);
  assert.equal(c.listedOnCmc, true);
});

test('tokenDetail：24h 统计、owner 零地址=已放弃、lmc、cexs、pls', () => {
  const d = toTokenDetail({
    n: 'Pepe', sym: 'PEPE', addr: '0x6982508145454ce325ddbe47a25d4ec3d2311933', plt: 'Ethereum', pid: 1, dec: 18,
    own: '0x0000000000000000000000000000000000000000', web: 'https://www.pepe.vip/', tw: 'https://twitter.com/pepecoineth', tg: '',
    lg: 'https://logo', pubAt: '1681483895000', mcap: '1440983402.5', lmc: '1419776084.2', ts: '420690000000000',
    liqUsd: '28601100', hld: '0', p: '0.0000034', fpct: '1681483895000', rl: 'safe', lf: 1, cid: 24478,
    turl: 'https://app.uniswap.org/#/swap',
    sts: [
      { tp: '1h', vu: '1', txs: '1', nb: '1', ns: '0', bvu: '1', svu: '0', but: '1', sut: '0', pc: 0.01, ut: '1' },
      { tp: '24h', vu: '202347614.98', txs: '10117', nb: '4530', ns: '5587', bvu: '104830170', svu: '97517444', but: '1840', sut: '2490', pc: -0.0136, ut: '3696' },
    ],
    pls: [
      { addr: '0xpool', v24: '46108152', pubAt: '1620232628000', t0: { addr: '0xweth', sym: 'WETH' }, t1: { addr: '0x6982', sym: 'PEPE' }, bidx: 1, exid: 1348, exn: 'Uniswap v2', liqUsd: '26449566.4', lr: null, br: null },
    ],
    cexs: [
      { id: 270, slug: 'binance', n: 'Binance', cat: ['SPOT', 'DERIVATIVES'] },
      { id: 1, slug: 'primexbt', n: 'PrimeXBT', cat: ['DERIVATIVES'] },
    ],
  });
  assert.ok(d);
  const c = d.candidate;
  assert.equal(c.symbol, 'PEPE');
  assert.equal(c.networkSlug, 'ethereum');
  assert.equal(c.ownerRenounced, true);
  assert.equal(c.fdvUsd, 1440983402.5);
  assert.equal(c.listingMarketCapUsd, 1419776084.2);
  assert.equal(c.holdersCount, undefined, 'hld=0 不可信，应为 undefined');
  assert.equal(c.buys24h, 4530);
  assert.equal(c.sells24h, 5587);
  assert.equal(c.traders24h, 3696);
  assert.ok(Math.abs(c.priceChange24hPct! - -1.36) < 1e-9);
  assert.equal(c.riskLevel, 'safe');
  assert.equal(c.cexListings?.length, 2);
  assert.equal(c.telegram, undefined);
  assert.equal(d.pools.length, 1);
  assert.equal(d.pools[0]?.dexName, 'Uniswap v2');
  assert.equal(d.pools[0]?.quoteSymbol, 'WETH', 'bidx=1 → 报价币是 t0');
  assert.equal(d.pools[0]?.liquidityUsd, 26449566.4);
});

test('tokenDetail：非零 owner 未放弃、hld>0 可用', () => {
  const d = toTokenDetail({ n: 'X', sym: 'X', addr: 'So111', plt: 'Solana', own: '', hld: '220517', p: '1' });
  assert.equal(d?.candidate.ownerRenounced, undefined);
  assert.equal(d?.candidate.holdersCount, 220517);
});

test('TokenTopPoolDTO：lr/br 小数→百分比', () => {
  const p = toPoolInfo({ addr: 'a', exn: 'Raydium', liqUsd: '149682.93', v24: '1', bidx: 0, t0: { sym: 'BONK' }, t1: { sym: 'SOL' }, lr: 0.95, br: 0.1 });
  assert.equal(p.quoteSymbol, 'SOL');
  assert.equal(p.lockedRatePct, 95);
  assert.equal(p.burnedRatePct, 10);
});

test('pairs/quotes 记录：代币取 base_asset_*，池子取 contract_address，quote 数组，百分比不 ×100', () => {
  const c = toTokenCandidate({
    contract_address: '0xpool', name: 'PEPE/WETH', base_asset_ucid: '24478', base_asset_name: 'Pepe', base_asset_symbol: 'PEPE',
    base_asset_contract_address: '0xtoken', dex_slug: 'uniswap-v3', network_slug: 'ethereum',
    quote: [{ price: 0.00001, volume_24h: 5000, liquidity: 9000, fully_diluted_value: 123456, percent_change_price_24h: 4.2 }],
  });
  assert.equal(c?.address, '0xtoken');
  assert.equal(c?.pairAddress, '0xpool');
  assert.equal(c?.name, 'Pepe');
  assert.equal(c?.priceChange24hPct, 4.2);
  assert.equal(c?.liquidityUsd, 9000);
});

test('HolderCountVO 与 HolderTrendVO 都能映射；holdingRatio 小数→百分比', () => {
  assert.equal(toHoldersOverview({ platformId: 1, count: '15967818', tokenAddress: '0x' })?.totalHolders, 15967818);
  const o = toHoldersOverview({ ts: '1788220800000', holders: '15969321', holdingRatioOfTop100: '0.6817360036', holdingRatioOfTop50: '0.6293392076', holdingRatioOfTop10: '0.4944438823' });
  assert.equal(o?.totalHolders, 15969321);
  assert.ok(Math.abs(o!.top10Pct! - 49.44438823) < 1e-6);
});

test('tag_count 实测形态 [{ tag, hc, tb, hr }]', () => {
  const t = toTagDistribution([
    { tag: 'tag_dev', hc: '1', tb: '2478.41', hr: '0.000001' },
    { tag: 'tag_whale', hc: '8', tb: '5000', hr: '0.215' },
  ]);
  assert.equal(t?.dev, 1);
  assert.equal(t?.whale, 8);
  assert.ok(Math.abs(t!.holdingPct!.whale! - 21.5) < 1e-9);
});

test('HolderDetailVO：walletAddress、percent 已是百分比、tags JSON 字符串、explorer %s 占位', () => {
  const h = toHolderEntry({
    blockHeight: '25845146', firstActiveTime: '1562684042', price: '0.999',
    walletAddress: '0xf977814e90da44bfa03b6295a0616a897441acec', platformId: 1,
    percent: '19.2511548200', balance: '17000000000.000198', totalSupply: '88306390736',
    publicName: 'Binance: Hot Wallet 20', tags: '{"tag_whale":1,"tag_smart_contract":0}',
    addressExplorerUrl: 'https://etherscan.io/address/%s',
  });
  assert.equal(h.address, '0xf977814e90da44bfa03b6295a0616a897441acec');
  assert.ok(Math.abs(h.percent! - 19.25115482) < 1e-6);
  assert.deepEqual(h.tags, ['tag_whale']);
  assert.equal(h.publicName, 'Binance: Hot Wallet 20');
  assert.equal(h.explorerUrl, 'https://etherscan.io/address/0xf977814e90da44bfa03b6295a0616a897441acec');
  assert.equal(h.firstActiveAt, 1562684042000);
});

test('security/detail：riskCode 映射、display 汇总优先、未开源反转', () => {
  const s = toSecurityDetail({
    platformName: 'Ethereum', securityLevel: 'safe', categoryLevel: 'safe',
    extra: { buyTax: '0', sellTax: '0.03', isVerified: true, isFlaggedByVendor: false, source: 'BINANCE' },
    evmDisplay: { honeypotStatus: 'No', unverifiedContractStatus: 'No', rugPullStatus: 'Unknown', fakeTokenStatus: 'Unknown' },
    securityItems: [
      { code: 'Blacklist Restrictions Found', riskCode: 'blacklist_function', riskyLevel: 'y', isHit: true, groupId: 'CONTRACT_RISK' },
      { code: 'On-Chain Token Trading May Be Paused', riskyLevel: 'y', isHit: true },
      { code: 'Mintable Detected', riskCode: 'mintable', riskyLevel: 'y', isHit: true },
      { code: 'Contract Renounced', riskCode: 'contract_not_renounced', riskyLevel: 'g', isHit: false },
      { code: 'Contract Upgradeable', riskCode: 'upgradeable', riskyLevel: 'y', isHit: true },
      { code: 'Contract Code Verified', riskCode: 'unverified_contract', riskyLevel: 'g', isHit: false },
      { code: 'Self-Destruct Not Found', riskCode: 'selfdestruct', riskyLevel: 'g', isHit: false },
    ],
    tags: ['STABLE_COIN'],
  });
  assert.ok(s);
  assert.equal(s.provider, 'BINANCE');
  assert.equal(s.level, 'safe');
  assert.equal(s.isBlacklisted, true);
  assert.equal(s.transferPausable, true);
  assert.equal(s.isMintable, true);
  assert.equal(s.ownerRenounced, true);
  assert.equal(s.isProxy, true);
  assert.equal(s.openSource, true);
  assert.equal(s.selfDestruct, false);
  assert.equal(s.isHoneypot, false);
  assert.equal(s.sellTaxPct, 3);
  assert.equal(s.items.filter((i) => i.hit).length, 4);
  assert.deepEqual(s.tags, ['STABLE_COIN']);
});

test('security/detail：Solana 用 solanaDisplay', () => {
  const s = toSecurityDetail({ securityLevel: 'safe', extra: { source: 'BINANCE' }, solanaDisplay: { mintableStatus: 'No', freezableStatus: 'Yes' }, securityItems: [] });
  assert.equal(s?.isMintable, false);
  assert.equal(s?.freezable, true);
});

test('GoPlus security_scan { third_party[], aggregated[] } 仍可解析', () => {
  const s = toSecurityScan({
    buy_tax: 0.01,
    security_scan: [{ third_party: [{ honeypot: false, mintable: true }], aggregated: [{ contract_verified: true, honeypot: true }] }],
  });
  assert.equal(s?.isHoneypot, true);
  assert.equal(s?.isMintable, true);
  assert.equal(s?.buyTaxPct, 1);
});

test('asArray：{data:{tks}} / {holders} / 裸数组', () => {
  assert.equal(asArray({ total: 1, tks: [{ n: 'x' }] }).length, 1);
  assert.equal(asArray({ holders: [{}, {}] }).length, 2);
  assert.equal(asArray([{}]).length, 1);
});

test('缺少地址或链的记录被丢弃', () => {
  assert.equal(toTokenCandidate({ n: 'X', s: 'X' }), null);
});
