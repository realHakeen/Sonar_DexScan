import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detectChain, looksLikeAddress } from '../src/domain/detectChain.js';

test('EVM 地址需要 search 反查具体链', () => {
  const d = detectChain('0xdAC17F958D2ee523a2206206994597C13D831ec7');
  assert.equal(d.family, 'evm');
  assert.equal(d.slug, undefined);
  assert.equal(d.needsLookup, true);
});

test('Solana base58 直接定链', () => {
  const d = detectChain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  assert.equal(d.family, 'solana');
  assert.equal(d.slug, 'solana');
  assert.equal(d.needsLookup, false);
});

test('Tron 的 T 开头 base58 不会被误判为 Solana', () => {
  const d = detectChain('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.equal(d.slug, 'tron');
});

test('TON 的 EQ/UQ 前缀', () => {
  const d = detectChain('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');
  assert.equal(d.slug, 'ton');
});

test('0x + 64 位 hex 归到 Sui/Aptos 候选', () => {
  const d = detectChain('0x' + 'a'.repeat(64));
  assert.deepEqual(d.candidates, ['sui', 'aptos']);
  assert.equal(d.needsLookup, true);
});

test('Sui coin type 优先于纯 hex 规则', () => {
  const d = detectChain('0x2::sui::SUI');
  assert.deepEqual(d.candidates, ['sui', 'aptos']);
});

test('bech32 前缀映射到 Cosmos 系链', () => {
  const d = detectChain('inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r');
  assert.equal(d.slug, 'injective');
});

test('普通单词不是地址', () => {
  assert.equal(looksLikeAddress('pepe'), false);
  assert.equal(looksLikeAddress('0x123'), false);
});
