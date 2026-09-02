import type { RawRecord } from './types.js';
import { chainRegistry } from '../../domain/chains.js';
import type {
  CexListing,
  HolderEntry,
  HolderTagDistribution,
  HoldersOverview,
  PoolInfo,
  SecurityItem,
  SecurityScan,
  TokenCandidate,
} from '../../domain/types.js';

/**
 * 所有上游字段读取都经过这里。每个 mapper 的字段名都已用真实响应核对（见 endpoints.ts 注释），
 * 别名数组里靠前的是实测名，靠后的是文档名 / 早期猜测，保留作容错。
 */

function dig(obj: RawRecord, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as RawRecord)[seg];
  }
  return cur;
}

export function pickString(obj: RawRecord, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = dig(obj, k);
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** 上游数值几乎全是字符串（"0.9994"、"15967818"），统一转 number。 */
export function pickNumber(obj: RawRecord, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = dig(obj, k);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function pickBoolean(obj: RawRecord, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = dig(obj, k);
    if (typeof v === 'boolean') return v;
    if (v === '1' || v === 1) return true;
    if (v === '0' || v === 0) return false;
  }
  return undefined;
}

/** 时间戳：毫秒字符串 "1511829681000"、秒 1562684042、ISO 字符串 都归一到 ms。 */
export function pickTimestamp(obj: RawRecord, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = dig(obj, k);
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return undefined;
}

/**
 * 24h 涨跌口径（实测）：
 * - v1 search.pc24h、v1 token.sts[].pc 是小数（PEPE -0.0136 ↔ 主 API -1.23%），×100
 * - v4 quote[].percent_change_price_24h 已是百分比
 */
function pickPercentChange24h(raw: RawRecord): number | undefined {
  const fraction = pickNumber(raw, 'pc24h', 'pc', 'price_change_24h');
  if (fraction !== undefined) return fraction * 100;
  return pickNumber(raw, 'quote.0.percent_change_price_24h', 'quote.USD.percent_change_24h', 'percent_change_price_24h', 'percent_change_24h');
}

function normalizeTwitter(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (v.startsWith('http')) return v;
  return `https://x.com/${v.replace(/^@/, '')}`;
}

/** 税率可能是 0.05（小数）也可能是 5（百分比），统一成百分比。 */
function normalizeTax(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return v <= 1 ? v * 100 : v;
}

const ZERO_ADDRESS = /^0x0{40}$/i;

/**
 * search.tks[] / pairs-quotes 记录 → TokenCandidate。
 * pair 记录里 contract_address 是池子地址，代币在 base_asset_contract_address，顺序不能反。
 */
export function toTokenCandidate(raw: RawRecord): TokenCandidate | null {
  const address = pickString(raw, 'addr', 'base_asset_contract_address', 'token_address', 'contract_address', 'address');
  const platform = pickString(raw, 'plt', 'network_slug', 'platform_slug', 'platform.slug', 'network', 'chain');
  if (!address || !platform) return null;

  const isPairRecord = pickString(raw, 'base_asset_contract_address') !== undefined;

  return {
    cmcId: pickNumber(raw, 'cid', 'base_asset_ucid', 'cmc_id'),
    name: pickString(raw, 'n', 'base_asset_name', 'name') ?? 'Unknown',
    symbol: (pickString(raw, 's', 'sym', 'base_asset_symbol', 'symbol') ?? '???').toUpperCase(),
    // 显示名 → URL 安全的 slug，未知链顺手登记进注册表
    networkSlug: chainRegistry.remember(platform),
    platform,
    networkId: pickNumber(raw, 'pltId', 'pid', 'network_id', 'platform_id'),
    address,
    logo: pickString(raw, 'l', 'lg', 'logo'),
    website: pickString(raw, 'w', 'web', 'website'),
    twitter: normalizeTwitter(pickString(raw, 'x', 'tw', 'twitter')),
    priceUsd: pickNumber(raw, 'pu', 'p', 'quote.0.price', 'quote.USD.price', 'price'),
    priceChange24hPct: pickPercentChange24h(raw),
    fdvUsd: pickNumber(raw, 'mc', 'mcap', 'fdv', 'quote.0.fully_diluted_value', 'fully_diluted_value'),
    totalSupply: pickNumber(raw, 'tsup', 'ts', 'total_supply_base_asset', 'total_supply'),
    decimals: pickNumber(raw, 'dec', 'decimals'),
    volume24hUsd: pickNumber(raw, 'v24h', 'quote.0.volume_24h', 'quote.USD.volume_24h', 'volume_24h'),
    liquidityUsd: pickNumber(raw, 'liq', 'liqUsd', 'quote.0.liquidity', 'quote.USD.liquidity', 'liquidity'),
    traders24h: pickNumber(raw, 'ut24h', 'unique_traders_24h'),
    txns24h: pickNumber(raw, 'txns24h', 'num_transactions_24h'),
    buys24h: pickNumber(raw, '24h_no_of_buys'),
    sells24h: pickNumber(raw, '24h_no_of_sells'),
    buyVolume24hUsd: pickNumber(raw, 'quote.0.24h_buy_volume', '24h_buy_volume'),
    sellVolume24hUsd: pickNumber(raw, 'quote.0.24h_sell_volume', '24h_sell_volume'),
    holdersCount: pickNumber(raw, 'holders'),
    percentPooled: pickNumber(raw, 'percent_pooled_base_asset'),
    pairAddress: isPairRecord ? pickString(raw, 'contract_address', 'pair_address') : pickString(raw, 'pa', 'pair_address'),
    dexName: pickString(raw, 'dex_slug', 'dex_name'),
    // fpct = first pool created time，最贴近"上线时长"
    listedAt: pickTimestamp(raw, 'fpct', 'fpt', 'pt', 'pool_created', 'date_launched', 'created_at'),
    listedOnCmc: pickNumber(raw, 'lf') === undefined ? undefined : pickNumber(raw, 'lf') === 1,
    raw,
  };
}

/** TokenDetailDTO（/v1/dex/token）→ 完整候选 + 头部池子。 */
export function toTokenDetail(raw: RawRecord): { candidate: TokenCandidate; pools: PoolInfo[] } | null {
  const base = toTokenCandidate(raw);
  if (!base) return null;

  const stats = Array.isArray(raw['sts']) ? (raw['sts'] as RawRecord[]) : [];
  const s24 = stats.find((s) => s['tp'] === '24h');
  const owner = pickString(raw, 'own');
  const renouncedAddr = pickString(raw, 'rnc');
  const holders = pickNumber(raw, 'hld');

  const candidate: TokenCandidate = {
    ...base,
    telegram: pickString(raw, 'tg'),
    listingMarketCapUsd: pickNumber(raw, 'lmc'),
    circulatingSupply: pickNumber(raw, 'cs', 'ltcs'),
    holdersCount: holders && holders > 0 ? holders : undefined,
    listedAt: pickTimestamp(raw, 'fpct', 'lchAt', 'pubAt', 'fpt'),
    ownerAddress: owner,
    ownerRenounced: owner ? ZERO_ADDRESS.test(owner) || Boolean(renouncedAddr) : renouncedAddr ? true : undefined,
    riskLevel: pickString(raw, 'rl'),
    tradeUrl: pickString(raw, 'turl'),
    cexListings: toCexListings(raw['cexs']),
  };

  if (s24) {
    candidate.volume24hUsd = pickNumber(s24, 'vu') ?? candidate.volume24hUsd;
    candidate.txns24h = pickNumber(s24, 'txs');
    candidate.buys24h = pickNumber(s24, 'nb');
    candidate.sells24h = pickNumber(s24, 'ns');
    candidate.buyVolume24hUsd = pickNumber(s24, 'bvu');
    candidate.sellVolume24hUsd = pickNumber(s24, 'svu');
    candidate.buyers24h = pickNumber(s24, 'but');
    candidate.sellers24h = pickNumber(s24, 'sut');
    candidate.traders24h = pickNumber(s24, 'ut') ?? candidate.traders24h;
    const pc = pickNumber(s24, 'pc');
    if (pc !== undefined) candidate.priceChange24hPct = pc * 100;
  }

  const pools = (Array.isArray(raw['pls']) ? (raw['pls'] as RawRecord[]) : []).map(toPoolInfo);
  return { candidate, pools };
}

function toCexListings(v: unknown): CexListing[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((c): c is RawRecord => Boolean(c) && typeof c === 'object')
    .map((c) => ({
      slug: pickString(c, 'slug') ?? '',
      name: pickString(c, 'n', 'name') ?? pickString(c, 'slug') ?? '',
      categories: Array.isArray(c['cat']) ? (c['cat'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    }))
    .filter((c) => c.slug !== '');
}

/** TokenTopPoolDTO（addr/exn/liqUsd/v24/t0/t1/bidx/lr/br）或 DexSpotPairDTO → PoolInfo。 */
export function toPoolInfo(raw: RawRecord): PoolInfo {
  const bidx = pickNumber(raw, 'bidx');
  const quoteToken = bidx === undefined ? undefined : ((raw[bidx === 0 ? 't1' : 't0'] as RawRecord | undefined) ?? undefined);
  const lr = pickNumber(raw, 'lr');
  const br = pickNumber(raw, 'br');
  return {
    pairAddress: pickString(raw, 'addr', 'contract_address', 'pair_address'),
    dexName: pickString(raw, 'exn', 'dex_slug', 'dex_name'),
    liquidityUsd: pickNumber(raw, 'liqUsd', 'quote.0.liquidity', 'liquidity'),
    volume24hUsd: pickNumber(raw, 'v24', 'quote.0.volume_24h', 'volume_24h'),
    quoteSymbol: quoteToken ? pickString(quoteToken, 'sym') : pickString(raw, 'quote_asset_symbol'),
    lockedRatePct: lr === undefined ? undefined : lr <= 1 ? lr * 100 : lr,
    burnedRatePct: br === undefined ? undefined : br <= 1 ? br * 100 : br,
    isTop: typeof raw['top'] === 'boolean' ? (raw['top'] as boolean) : undefined,
    createdAt: pickTimestamp(raw, 'pubAt', 'pool_created', 'created_at'),
    raw,
  };
}

/** HolderCountVO { count } 与 HolderTrendVO { holders, holdingRatioOfTop10… } 都能用。 */
export function toHoldersOverview(raw: RawRecord | null): HoldersOverview | undefined {
  if (!raw) return undefined;
  const o: HoldersOverview = {
    totalHolders: pickNumber(raw, 'count', 'holders', 'holderCount'),
    top10Pct: pickNumber(raw, 'holdingRatioOfTop10'),
    top50Pct: pickNumber(raw, 'holdingRatioOfTop50'),
    top100Pct: pickNumber(raw, 'holdingRatioOfTop100'),
  };
  // 实测 holdingRatioOfTop10 = "0.4944"（小数），统一成百分比
  for (const k of ['top10Pct', 'top50Pct', 'top100Pct'] as const) {
    const v = o[k];
    if (v !== undefined && v <= 1) o[k] = v * 100;
  }
  return o;
}

const TAG_FIELD: Record<string, 'sniper' | 'dev' | 'whale' | 'bot' | 'smartMoney' | 'kol'> = {
  tag_sniper: 'sniper',
  tag_dev: 'dev',
  tag_whale: 'whale',
  tag_bot: 'bot',
  tag_smart_money: 'smartMoney',
  tag_kol: 'kol',
};

/** tag_count 实测返回 [{ tag, hc, tb, hr }]；也兼容 { holders: [...] } 与平铺形态。 */
export function toTagDistribution(data: unknown): HolderTagDistribution | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const rec = data as RawRecord;
  const list = Array.isArray(data) ? data : Array.isArray(rec['holders']) ? (rec['holders'] as unknown[]) : null;

  if (!list) {
    return {
      sniper: pickNumber(rec, 'tag_sniper'),
      dev: pickNumber(rec, 'tag_dev'),
      whale: pickNumber(rec, 'tag_whale'),
      bot: pickNumber(rec, 'tag_bot'),
      smartMoney: pickNumber(rec, 'tag_smart_money'),
      kol: pickNumber(rec, 'tag_kol'),
    };
  }

  const out: HolderTagDistribution = { holdingPct: {} };
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as RawRecord;
    const field = TAG_FIELD[pickString(row, 'tag') ?? ''];
    if (!field) continue;
    out[field] = pickNumber(row, 'hc', 'count');
    const ratio = pickNumber(row, 'hr', 'ratio');
    if (ratio !== undefined) out.holdingPct![field] = ratio <= 1 ? ratio * 100 : ratio;
  }
  return out;
}

/** 实测 tags 是 JSON 字符串 '{"tag_whale":1,"tag_smart_contract":0}'，取值为 1 的键。 */
function parseHolderTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string');
  if (typeof v !== 'string' || v.trim() === '') return [];
  const s = v.trim();
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      return Object.entries(obj)
        .filter(([, val]) => val === 1 || val === true || val === '1')
        .map(([k]) => k);
    } catch {
      /* fallthrough */
    }
  }
  return s.split(/[,\s]+/).filter(Boolean);
}

/** HolderDetailVO → HolderEntry。percent 上游已是百分比（"19.25"），不做换算。 */
export function toHolderEntry(raw: RawRecord): HolderEntry {
  const address = pickString(raw, 'walletAddress', 'address');
  const explorerTpl = pickString(raw, 'addressExplorerUrl');
  return {
    address,
    publicName: pickString(raw, 'publicName'),
    balance: pickNumber(raw, 'balance', 'actualBalance'),
    percent: pickNumber(raw, 'percent'),
    buyUsd: pickNumber(raw, 'buyUsd'),
    sellUsd: pickNumber(raw, 'sellUsd'),
    realizedPnlUsd: pickNumber(raw, 'realizedPnl'),
    realizedPnlPct: pickNumber(raw, 'realizedPnlPercent'),
    firstActiveAt: pickTimestamp(raw, 'firstActiveTime'),
    lastActiveAt: pickTimestamp(raw, 'lastActiveTime'),
    // 实测模板含 %s 占位
    explorerUrl: explorerTpl && address ? explorerTpl.replace('%s', address) : explorerTpl,
    tags: parseHolderTags(raw['tags'] ?? raw['tag']),
    raw,
  };
}

// ---------------------------------------------------------------------------
// 安全检测
// ---------------------------------------------------------------------------

/** riskCode → 布尔字段。第二个元素表示"命中即 true"还是"命中即 false"。 */
const RISK_CODE_FIELD: Record<string, [keyof SecurityScan, boolean]> = {
  honeypot: ['isHoneypot', true],
  whitelist_function: ['isWhitelisted', true],
  cooldown_function: ['tradingCoolDown', true],
  blacklist_function: ['isBlacklisted', true],
  sell_all_forbidden: ['cannotSellAll', true],
  antiwhale: ['antiWhale', true],
  contract_not_renounced: ['ownerRenounced', false],
  selfdestruct: ['selfDestruct', true],
  mintable: ['isMintable', true],
  malicious_creator: ['maliciousCreator', true],
  hack: ['hackRisk', true],
  upgradeable: ['isProxy', true],
  tax_modifiable: ['slippageModifiable', true],
  unverified_contract: ['openSource', false],
  hidden_owner: ['hiddenOwner', true],
  airdrop_scam: ['airdropScam', true],
};

/** riskCode 为空时按 code 文案兜底。 */
const CODE_TEXT_FIELD: Array<[RegExp, keyof SecurityScan]> = [
  [/paused/i, 'transferPausable'],
  [/balance manipulation/i, 'ownerChangeBalance'],
  [/freezable/i, 'freezable'],
  [/honeypot/i, 'isHoneypot'],
  [/hidden owner/i, 'hiddenOwner'],
  [/airdrop/i, 'airdropScam'],
  [/cannot buy|buy restriction/i, 'cannotBuy'],
  [/take back ownership/i, 'canTakeBackOwnership'],
];

function yesNo(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return undefined;
}

/** /v1/dex/security/detail 的 TokenSecurityResponseDTO → SecurityScan。 */
export function toSecurityDetail(raw: RawRecord | null): SecurityScan | undefined {
  if (!raw) return undefined;
  const extra = (raw['extra'] as RawRecord | undefined) ?? {};
  const evm = (raw['evmDisplay'] as RawRecord | undefined) ?? undefined;
  const sol = (raw['solanaDisplay'] as RawRecord | undefined) ?? undefined;
  const display = evm ?? sol ?? {};

  const items: SecurityItem[] = (Array.isArray(raw['securityItems']) ? (raw['securityItems'] as RawRecord[]) : []).map((it) => ({
    code: pickString(it, 'code') ?? '',
    riskCode: pickString(it, 'riskCode'),
    level: pickString(it, 'riskyLevel') ?? 'g',
    hit: it['isHit'] === true,
    description: pickString(it, 'des'),
    group: pickString(it, 'groupId'),
  }));

  const scan: SecurityScan = {
    provider: pickString(extra, 'source') ?? 'CMC',
    level: pickString(raw, 'securityLevel'),
    buyTaxPct: normalizeTax(pickNumber(extra, 'buyTax')),
    sellTaxPct: normalizeTax(pickNumber(extra, 'sellTax')),
    contractVerified: typeof extra['isVerified'] === 'boolean' ? (extra['isVerified'] as boolean) : undefined,
    flaggedByVendor: typeof extra['isFlaggedByVendor'] === 'boolean' ? (extra['isFlaggedByVendor'] as boolean) : undefined,
    reported: typeof extra['isReported'] === 'boolean' ? (extra['isReported'] as boolean) : undefined,
    honeypotStatus: pickString(display, 'honeypotStatus'),
    rugPullStatus: pickString(display, 'rugPullStatus'),
    fakeTokenStatus: pickString(display, 'fakeTokenStatus'),
    mintableStatus: pickString(display, 'mintableStatus'),
    freezableStatus: pickString(display, 'freezableStatus'),
    items,
    tags: Array.isArray(raw['tags']) ? (raw['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
    extra: {},
  };

  const set = (field: keyof SecurityScan, value: boolean) => {
    (scan as unknown as Record<string, unknown>)[field] = value;
  };

  for (const it of items) {
    const mapped = it.riskCode ? RISK_CODE_FIELD[it.riskCode] : undefined;
    if (mapped) {
      const [field, hitMeansTrue] = mapped;
      set(field, hitMeansTrue ? it.hit : !it.hit);
      continue;
    }
    const byText = CODE_TEXT_FIELD.find(([re]) => re.test(it.code));
    if (byText) set(byText[1], it.hit);
  }

  // display 的 Yes/No 优先级高于 items（它是汇总结论）
  const hp = yesNo(scan.honeypotStatus);
  if (hp !== undefined) scan.isHoneypot = hp;
  const mint = yesNo(scan.mintableStatus);
  if (mint !== undefined) scan.isMintable = mint;
  const frz = yesNo(scan.freezableStatus);
  if (frz !== undefined) scan.freezable = frz;
  const unverified = yesNo(pickString(display, 'unverifiedContractStatus'));
  if (unverified !== undefined) scan.openSource = !unverified;
  if (scan.openSource === undefined && scan.contractVerified !== undefined) scan.openSource = scan.contractVerified;

  return scan;
}

/**
 * pairs/quotes 的 GoPlus security_scan[]（{ third_party[], aggregated[] }）→ SecurityScan。
 * 扫描主链路已改用 security/detail，这里保留给单池刷新。
 */
const GOPLUS_FLAGS: Array<[keyof SecurityScan, string[]]> = [
  ['isHoneypot', ['honeypot', 'is_honeypot']],
  ['cannotBuy', ['cannot_buy']],
  ['cannotSellAll', ['cannot_sell_all']],
  ['selfDestruct', ['self_destruct', 'selfdestruct']],
  ['airdropScam', ['airdrop_scam', 'is_airdrop_scam']],
  ['isMintable', ['mintable', 'is_mintable']],
  ['isProxy', ['proxy', 'is_proxy']],
  ['hiddenOwner', ['hidden_owner']],
  ['canTakeBackOwnership', ['can_take_back_ownership']],
  ['ownerChangeBalance', ['owner_change_balance']],
  ['isBlacklisted', ['blacklisted', 'is_blacklisted']],
  ['isWhitelisted', ['whitelisted', 'is_whitelisted']],
  ['transferPausable', ['transfer_pausable']],
  ['slippageModifiable', ['slippage_modifiable']],
  ['antiWhale', ['anti_whale', 'is_anti_whale']],
  ['tradingCoolDown', ['trading_cool_down', 'trading_cooldown']],
  ['openSource', ['open_source', 'is_open_source']],
  ['contractVerified', ['contract_verified']],
  ['trustList', ['trust_list']],
];

function flattenScan(v: unknown): RawRecord | null {
  if (!v) return null;
  const out: RawRecord = {};
  const absorb = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(absorb);
      return;
    }
    const rec = item as RawRecord;
    if (Array.isArray(rec['third_party']) || Array.isArray(rec['aggregated'])) {
      absorb(rec['third_party']);
      absorb(rec['aggregated']);
      return;
    }
    const key = rec['key'] ?? rec['name'] ?? rec['field'];
    if (typeof key === 'string' && 'value' in rec && Object.keys(rec).length <= 3) {
      out[key] = rec['value'];
      return;
    }
    Object.assign(out, rec);
  };
  absorb(v);
  return Object.keys(out).length ? out : null;
}

export function toSecurityScan(raw: RawRecord | null): SecurityScan | undefined {
  if (!raw) return undefined;
  const scanRaw = dig(raw, 'security_scan') ?? dig(raw, 'securityScan');
  const hasTax = pickNumber(raw, 'buy_tax', 'sell_tax') !== undefined;
  if (!scanRaw && !hasTax) return undefined;
  const scan = flattenScan(scanRaw) ?? {};

  const out: SecurityScan = {
    provider: 'GoPlus',
    buyTaxPct: normalizeTax(pickNumber(raw, 'buy_tax') ?? pickNumber(scan, 'buy_tax')),
    sellTaxPct: normalizeTax(pickNumber(raw, 'sell_tax') ?? pickNumber(scan, 'sell_tax')),
    items: [],
    tags: [],
    extra: {},
  };
  for (const [field, keys] of GOPLUS_FLAGS) {
    const v = pickBoolean(scan, ...keys);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[field] = v;
  }
  const renounced = pickBoolean(scan, 'owner_renounced', 'is_owner_renounced');
  if (renounced !== undefined) out.ownerRenounced = renounced;
  else {
    const owner = pickString(scan, 'owner_address');
    if (owner) out.ownerRenounced = ZERO_ADDRESS.test(owner);
  }
  return out;
}

// ---------------------------------------------------------------------------

/** 上游可能 {data:[...]}、{data:{tks:[...]}}、{holders:[...]} 或裸数组，统一拍平成数组。 */
export function asArray(data: unknown): RawRecord[] {
  if (Array.isArray(data)) return data as RawRecord[];
  if (data && typeof data === 'object') {
    for (const key of ['data', 'tks', 'holders', 'list', 'tokens', 'pairs', 'results', 'items']) {
      const v = (data as RawRecord)[key];
      if (Array.isArray(v)) return v as RawRecord[];
    }
    return [data as RawRecord];
  }
  return [];
}

export function asRecord(data: unknown): RawRecord | null {
  if (Array.isArray(data)) return (data[0] as RawRecord | undefined) ?? null;
  if (data && typeof data === 'object') return data as RawRecord;
  return null;
}
