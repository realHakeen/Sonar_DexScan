import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeCallback, encodeCallback } from '../src/bot/callbackData.js';

test('内联编码带 symbol 往返，且不超过 64 字节', () => {
  const data = encodeCallback({ action: 'scan', networkSlug: 'bnb', address: '0x' + 'b'.repeat(40), symbol: 'TRIA' });
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.deepEqual(decodeCallback(data), { action: 'scan', networkSlug: 'bnb', address: '0x' + 'b'.repeat(40), symbol: 'TRIA' });
});

test('Solana 地址 + symbol 仍在 64 字节内', () => {
  const addr = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const data = encodeCallback({ action: 'chain', networkSlug: 'solana', address: addr, symbol: 'BONK' });
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.equal(decodeCallback(data)?.symbol, 'BONK');
});

test('symbol 塞不下时退回无 symbol 的内联形式，而不是令牌', () => {
  const addr = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const data = encodeCallback({ action: 'scan', networkSlug: 'solana', address: addr, symbol: 'A_VERY_LONG_SYMBOL_NAME' });
  assert.ok(!data.startsWith('t|'));
  assert.equal(decodeCallback(data)?.address, addr);
  assert.equal(decodeCallback(data)?.symbol, undefined);
});

test('超长 Sui coin type 退回令牌表', () => {
  const addr = '0x' + 'a'.repeat(64) + '::module::VERYLONGSTRUCT';
  const data = encodeCallback({ action: 'scan', networkSlug: 'sui', address: addr });
  assert.ok(data.startsWith('t|'));
  assert.equal(decodeCallback(data)?.address, addr);
});

test('noop 与过期令牌', () => {
  assert.equal(decodeCallback(encodeCallback({ action: 'noop' }))?.action, 'noop');
  assert.equal(decodeCallback('t|doesnotexist'), null);
  assert.equal(decodeCallback('zz|x|y'), null);
});

test('perp 系列动作往返：address 字段承载 cid，多字符动作码可解码', () => {
  for (const action of ['perp', 'perp_refresh', 'perp_pick', 'back'] as const) {
    const data = encodeCallback({ action, address: '24478', symbol: 'PEPE' });
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
    assert.deepEqual(decodeCallback(data), { action, networkSlug: undefined, address: '24478', symbol: 'PEPE' });
  }
});
