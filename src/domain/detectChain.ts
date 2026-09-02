import type { ChainFamily } from './chains.js';

export interface ChainDetection {
  family: ChainFamily;
  /** 能直接定死链时给出；EVM 系为 undefined，需要 search 反查。 */
  slug?: string;
  /** 该地址格式可能对应的多条链（如 0x+64 位既可能是 Sui 也可能是 Aptos）。 */
  candidates: string[];
  /** 是否还需要调用 /v1/dex/search 才能确定链。 */
  needsLookup: boolean;
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const LONG_HEX = /^0x[a-fA-F0-9]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TON = /^[EU]Q[A-Za-z0-9_-]{46}$/;
const BECH32 = /^([a-z]{2,10})1[02-9ac-hj-np-z]{8,80}$/;
const SUI_TYPE = /^0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/;
const APTOS_TYPE = /^0x[a-fA-F0-9]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/;

/** bech32 前缀 -> CMC network_slug。 */
const BECH32_PREFIX: Record<string, string> = {
  inj: 'injective',
  osmo: 'osmosis',
  sei: 'sei',
  celestia: 'celestia',
  cosmos: 'cosmoshub',
  juno: 'juno',
  neutron: 'neutron',
};

/**
 * PRD F1 定链逻辑第 1 步：纯正则，零 API 消耗。
 * 只负责「定位链系」，EVM 系的具体链交给 search 反查。
 */
export function detectChain(input: string): ChainDetection {
  const addr = input.trim();

  if (TRON.test(addr)) {
    return { family: 'tron', slug: 'tron', candidates: ['tron'], needsLookup: false };
  }
  if (TON.test(addr)) {
    return { family: 'ton', slug: 'ton', candidates: ['ton'], needsLookup: false };
  }
  // Sui/Aptos 的 coin type 形如 0x...::module::STRUCT，必须先于纯 hex 判断
  if (SUI_TYPE.test(addr) || APTOS_TYPE.test(addr)) {
    return { family: 'sui', candidates: ['sui', 'aptos'], needsLookup: true };
  }
  if (EVM_ADDRESS.test(addr)) {
    // 同一个 0x 地址可能在多条 EVM 链上都有部署，必须反查
    return { family: 'evm', candidates: [], needsLookup: true };
  }
  if (LONG_HEX.test(addr)) {
    return { family: 'sui', candidates: ['sui', 'aptos'], needsLookup: true };
  }
  if (BASE58.test(addr)) {
    return { family: 'solana', slug: 'solana', candidates: ['solana'], needsLookup: false };
  }

  const bech32 = BECH32.exec(addr);
  if (bech32) {
    const prefix = bech32[1] ?? '';
    const slug = BECH32_PREFIX[prefix];
    return {
      family: 'cosmos',
      slug,
      candidates: slug ? [slug] : [],
      needsLookup: !slug,
    };
  }

  return { family: 'unknown', candidates: [], needsLookup: true };
}

/** 输入看起来是不是一个合约地址（而不是名称/ticker）。 */
export function looksLikeAddress(input: string): boolean {
  const s = input.trim();
  return (
    EVM_ADDRESS.test(s) ||
    LONG_HEX.test(s) ||
    TRON.test(s) ||
    TON.test(s) ||
    SUI_TYPE.test(s) ||
    BECH32.test(s) ||
    (BASE58.test(s) && s.length >= 32)
  );
}
