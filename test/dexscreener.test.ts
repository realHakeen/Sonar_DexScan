import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { caseLost } from '../src/api/dexscreener.js';

test('caseLost：全小写的 Solana 样地址才算丢了大小写；正常 base58 / EVM / 短串不算', () => {
  assert.equal(caseLost('hmh9syen37waf4hnycymuaprv6xftptdb3mqmemnppsr'), true);
  assert.equal(caseLost('lyi47medadevdd5hxjo1mbxhnbct841sfpcgryhtuwp'), true);
  assert.equal(caseLost('HMh9syEn37waF4hNYcyMuaPRv6xFTpTdb3MqMEMNppSR'), false);
  assert.equal(caseLost('0x6982508145454ce325ddbe47a25d4ec3d2311933'), false);
  assert.equal(caseLost('wrap.near'), false);
  assert.equal(caseLost('pepe'), false);
});
