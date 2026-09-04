import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chainRegistry, normalizeNetworkSlug } from '../src/domain/chains.js';

test('显示名 → slug：别名表命中', () => {
  assert.equal(normalizeNetworkSlug('Robinhood Chain'), 'robinhood');
  assert.equal(normalizeNetworkSlug('Robinhood'), 'robinhood');
  assert.equal(normalizeNetworkSlug('BNB Smart Chain (BEP20)'), 'bnb');
  assert.equal(normalizeNetworkSlug('BSC'), 'bnb');
  assert.equal(normalizeNetworkSlug('Sui Network'), 'sui');
  assert.equal(normalizeNetworkSlug('Sei v2'), 'sei');
  assert.equal(normalizeNetworkSlug('TRON'), 'tron');
});

test('显示名 → slug：未知链通用 slugify，结果可安全拼 URL', () => {
  assert.equal(normalizeNetworkSlug('ZEDXION Smart Chain'), 'zedxion-smart-chain');
  assert.equal(normalizeNetworkSlug('Some Chain (Testnet)'), 'some-chain');
  assert.ok(!/\s/.test(normalizeNetworkSlug('Any Thing With Spaces')));
});

test('DexScan URL 用 dexscanSlug（bnb → bsc），Robinhood 用 robinhood', () => {
  assert.equal(chainRegistry.dexscanUrl('bnb', '0xabc'), 'https://dex.coinmarketcap.com/token/bsc/0xabc');
  assert.equal(chainRegistry.dexscanUrl('robinhood', '0xabc'), 'https://dex.coinmarketcap.com/token/robinhood/0xabc');
  assert.equal(chainRegistry.dexscanUrl(normalizeNetworkSlug('Robinhood Chain'), '0xabc'), 'https://dex.coinmarketcap.com/token/robinhood/0xabc');
});

test('remember：未知链按显示名登记，卡片显示原名而不是小写 slug', () => {
  const slug = chainRegistry.remember('Krown');
  assert.equal(slug, 'krown');
  assert.equal(chainRegistry.displayName('krown'), 'Krown');
  assert.equal(chainRegistry.platformName('krown'), 'Krown');
});

test('链配色 emoji 与 logo URL', () => {
  assert.equal(chainRegistry.emoji('bnb'), '🟡');
  assert.equal(chainRegistry.emoji('solana'), '🟣');
  assert.equal(chainRegistry.emoji('some-unknown-chain'), '⛓');
  assert.equal(chainRegistry.logoUrl('bnb'), 'https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png');
  assert.equal(chainRegistry.logoUrl('some-unknown-chain', 12345), 'https://s2.coinmarketcap.com/static/img/coins/64x64/12345.png');
});
