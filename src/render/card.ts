import { chainRegistry } from '../domain/chains.js';
import { overallRisk } from '../domain/risk.js';
import { CMC_LISTING_URL, CMC_SUPPLY_METHODOLOGY_URL, PERP_TOP_VENUES, SPOT_TOP_VENUES } from '../config/constants.js';
import { spotPremiumPct } from '../domain/spot.js';
import type { LiquidationStats, PerpStats, PoolInfo, SecurityScan, SpotStats, TokenReport } from '../domain/types.js';
import {
  bar,
  bold,
  changeEmoji,
  code,
  escapeHtml,
  formatAge,
  formatApr,
  formatCount,
  formatFunding,
  formatPercent,
  fundingEmoji,
  formatPrice,
  formatRatio,
  formatUsd,
  formatUsdShort,
  label,
  link,
  pctShort,
  section,
  sharePct,
  shortDex,
  shortenAddress,
  tree,
} from './format.js';

const RISK_HEADER: Record<string, string> = {
  danger: '🚨 High risk',
  warn: '⚠️ Caution',
  ok: '✅ No obvious risks',
};

/**
 * PRD F3 扫描卡片。排版原则：
 * - 一行一个概念，最多两个强相关指标并排
 * - 标签用 <code> 等宽对齐，值用正常字体
 * - 原始数据配派生结论（买压 %、Vol/Liq、流通比）
 * - 任何字段缺失就整行省略，绝不显示 "undefined" 或猜测值
 */
export function renderScanCard(report: TokenReport): string {
  const p = report.primary;
  const chain = chainRegistry.get(p.networkSlug);
  const out: string[] = [];

  // ── 头部 ──
  // ✅ 链接到 CMC 收录（CMCP）说明；bold 里可以嵌链接，反过来不行
  out.push(`${bold(p.symbol)}${p.officialVerified ? ` ${link('✅', CMC_LISTING_URL)}` : ''} · ${escapeHtml(p.name)}`);
  const meta: string[] = [`${chainRegistry.emoji(p.networkSlug)} ${escapeHtml(chain.name)}`];
  const rank = report.core?.cmcRank ?? p.cmcRank;
  if (rank) meta.push(`🏅 #${rank}`);
  const age = formatAge(p.listedAt);
  if (age !== '—') meta.push(`🕐 ${age}`);
  if (p.ownerRenounced === true) meta.push('🔐 Renounced');
  out.push(meta.join(' · '));
  if (report.core?.categories.length) {
    const cats = report.core.categories.map((c) => c.replace(/\s+Ecosystem$/i, '')).slice(0, 3);
    out.push(`🏷 ${escapeHtml(cats.join(' / '))}`);
  }
  out.push('', code(p.address));
  out.push('', renderLinks(report));

  // ── Market ──（一行一个指标，手机 36 列内）
  out.push('', section('📊', 'Market'));
  const market: string[] = [];
  market.push(`${label('Price')} ${bold(formatPrice(p.priceUsd))}  ${changeEmoji(p.priceChange24hPct)} ${formatPercent(p.priceChange24hPct)}`);

  // 口径：MC 来自主 API（全链流通市值）；FDV 来自 DEX token 接口（本链 price × 总供应）。
  // 多链代币两者明显不一致时，各自标明口径。
  const chainFdv = p.fdvUsd;
  const coreFdv = report.core?.fdvUsd;
  // 刚收录的币主 API 常给 market_cap = 0，那是"未知"不是"零"
  const mcapRaw = report.core?.marketCapUsd ?? p.listingMarketCapUsd;
  const mcap = mcapRaw !== undefined && mcapRaw > 0 ? mcapRaw : undefined;
  // 全链 FDV 与本链 FDV 的差异超过 15% 才算多链（价格时点差异通常在 10% 内；真正多链的都在 30% 以上）
  const multiChain =
    chainFdv !== undefined && coreFdv !== undefined && coreFdv > 0 && Math.abs(coreFdv - chainFdv) / coreFdv > 0.15;
  if (mcap !== undefined) {
    const fdvForCirc = coreFdv ?? chainFdv;
    const circ = fdvForCirc && fdvForCirc > 0 ? Math.round((mcap / fdvForCirc) * 100) : undefined;
    // "circ." 链接到 CMC 的供应量口径说明
    market.push(`${label('MC')} ${formatUsdShort(mcap)}${multiChain ? ' all chains' : ''}${circ !== undefined && circ < 100 ? ` (${circ}% ${link('circ.', CMC_SUPPLY_METHODOLOGY_URL)})` : ''}`);
  }
  if (multiChain) {
    market.push(`${label('FDV')} ${formatUsdShort(coreFdv)} all chains`);
    market.push(`${label('FDV')} ${formatUsdShort(chainFdv)} ${escapeHtml(chain.name)}`);
  } else if (chainFdv !== undefined || coreFdv !== undefined) {
    market.push(`${label('FDV')} ${formatUsdShort(chainFdv ?? coreFdv)}`);
  }

  const volLiq = formatRatio(p.volume24hUsd, p.liquidityUsd);
  market.push(`${label('Vol')} ${formatUsdShort(p.volume24hUsd)}${volLiq ? `  (${volLiq} liq)` : ''}`);
  if (p.traders24h !== undefined) market.push(`${label('Traders')} ${formatCount(p.traders24h)}`);
  // 涨绿跌红只能靠 emoji 色块：Telegram 文本不支持颜色
  if (p.buys24h !== undefined || p.sells24h !== undefined) {
    market.push(`${label('Txns')} 🟢 ↑${formatCount(p.buys24h)} · 🔴 ↓${formatCount(p.sells24h)}`);
  } else if (p.txns24h !== undefined) {
    market.push(`${label('Txns')} ${formatCount(p.txns24h)}`);
  }
  if (p.buyVolume24hUsd !== undefined || p.sellVolume24hUsd !== undefined) {
    const pressure = sharePct(p.buyVolume24hUsd, p.sellVolume24hUsd);
    // 买压 ≥ 50% 绿、< 50% 红，色块放在结论后面
    const pressureMark = pressure === undefined ? '' : ` · ${pressure}% buy ${pressure >= 50 ? '🟢' : '🔴'}`;
    market.push(`${label('Flow')} +${formatUsdShort(p.buyVolume24hUsd)} / −${formatUsdShort(p.sellVolume24hUsd)}${pressureMark}`);
  }
  // Liq 放最后一行，紧接下面的 Pools 区块（口径 = 所有池子双边 TVL 合计）
  const poolTotal = Math.max(p.poolCount ?? 0, report.pools.length);
  // 流动性与池子数都链到该代币的 DexScan 页（池子列表在那里）
  const dexscan = chainRegistry.dexscanUrl(p.networkSlug, p.address);
  market.push(`${label('Liq')} ${link(formatUsdShort(p.liquidityUsd), dexscan)}${poolTotal > 0 ? ` total · ${link(String(poolTotal), dexscan)} pool${poolTotal === 1 ? '' : 's'}` : ''}`);
  out.push(...tree(market));

  // ── Pools ──（紧跟 Market 的 Liq）
  if (report.pools.length) {
    out.push('', section('💧', `Pools (${poolTotal})`));
    out.push(...tree(renderPoolRows(report.pools, dexscan)));
  }

  // ── Holders ──
  const h = report.holders;
  const t = report.tags;
  if (h || t) {
    const total = h?.totalHolders !== undefined ? `  ${formatCount(h.totalHolders)}` : '';
    // 24h 变化：与昨天的日线点比；0 变化不显示
    const delta =
      h?.change24hPct !== undefined && h.change24h !== undefined && h.change24h !== 0
        ? ` ${changeEmoji(h.change24hPct)} ${formatPercent(h.change24hPct)} 24h`
        : '';
    out.push('', `${section('👥', 'Holders')}${total}${delta}`);
    const rows: string[] = [];
    if (h?.top10Pct !== undefined) rows.push(`${label('Top10')} ${bar(h.top10Pct)} ${pctShort(h.top10Pct)}`);
    if (h?.top50Pct !== undefined) rows.push(`${label('Top50')} ${bar(h.top50Pct)} ${pctShort(h.top50Pct)}`);
    const tags = renderTags(t);
    // 每行最多两个标签，超出继续换行（标签位留空对齐），避免 Telegram 在窄屏上把第三个挤到下一行
    for (let i = 0; i < tags.length; i += 2) {
      rows.push(`${label(i === 0 ? 'Tags' : '')} ${tags.slice(i, i + 2).join(' · ')}`);
    }
    out.push(...tree(rows));
  }

  // ── Security ──
  const sec = report.security;
  if (sec) {
    const head = [section('🛡', 'Security'), escapeHtml(sec.provider)];
    if (sec.level) head.push(escapeHtml(sec.level));
    out.push('', head.join(' · '));
    out.push(...tree(renderSecurityRows(sec)));
  }

  // ── Perps ──（OI / 合约成交量 / 费率按 16 家白名单客户端聚合；爆仓是 CMC 的 9 家汇总）
  const perpRows = renderPerpRows(report.perp, report.liquidations, report.core?.spotVolume24hUsd ?? p.volume24hUsd);
  if (perpRows.length) {
    const pairs = report.perp?.totalPairs;
    out.push('', `${section('📈', 'Perps')}${pairs ? `  ${pairs} pair${pairs === 1 ? '' : 's'}` : ''}`);
    out.push(...tree(perpRows));
  }

  // ── Spot ──（CEX 上所、全链现货量与 24h 变化、CEX/DEX 拆分、白名单内各所占比、CEX 对 DEX 溢价）
  const spotRows = renderSpotRows(report, report.spot);
  if (spotRows.length) {
    const n = report.spot?.returnedPairs;
    const pairs = n ? `  ${report.spot!.complete ? n : `${n}+`} pairs` : '';
    out.push('', `${section('📈', 'Spot')}${pairs}`);
    out.push(...tree(spotRows));
  }

  // ── Risks ──
  const risks = visibleRisks(report);
  if (risks.length) {
    const [riskEmoji, ...riskTitle] = (RISK_HEADER[overallRisk(report.risks)] ?? '⚠️ Risks').split(' ');
    out.push('', section(riskEmoji!, riskTitle.join(' ')));
    out.push(...tree(risks.slice(0, 8).map((r) => escapeHtml(r.message))));
  }

  if (report.degraded.length) {
    const names = [...new Set(report.degraded.map((d) => DEGRADED_LABEL[d] ?? d))];
    out.push('', `<i>⚠️ Partial data — unavailable: ${escapeHtml(names.join(', '))}. Tap Refresh to retry.</i>`);
  }

  return out.join('\n');
}

const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 } as const;

/** degraded[] 里的内部标签 → 用户能看懂的名字。 */
const DEGRADED_LABEL: Record<string, string> = {
  tokenDetail: 'token details',
  security: 'security scan',
  holdersTrend: 'holder concentration',
  holdersCount: 'holder count',
  holderTags: 'holder tags',
  holderList: 'holder list',
  coreMarket: 'market cap & rank',
  quote: 'market data',
  spotPairs: 'spot venues',
  derivatives: 'perp OI & funding',
  liquidations: 'liquidations',
};

/** Security 区块已逐项列出的合约级 warn 项，Risks 里不再重复；danger 级永远保留。 */
const SECURITY_WARN_CODES = new Set([
  'mintable', 'ownership', 'pausable', 'owner_change_balance', 'slippage_modifiable',
  'closed_source', 'upgradeable', 'freezable', 'hack', 'security_level',
]);

/** 按严重度排序，去掉与其它区块重复的条目。 */
function visibleRisks(report: TokenReport): TokenReport['risks'] {
  const securityItemised = (report.security?.items.length ?? 0) > 0;
  const poolsShown = report.pools.length >= 2;
  return [...report.risks]
    .filter((r) => !(r.code === 'single_lp' && poolsShown))
    .filter((r) => !(securityItemised && r.level === 'warn' && SECURITY_WARN_CODES.has(r.code)))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

function renderTags(t: TokenReport['tags']): string[] {
  if (!t) return [];
  type TagKey = 'sniper' | 'dev' | 'whale' | 'bot' | 'smartMoney' | 'kol';
  const parts: string[] = [];
  const item = (emoji: string, key: TagKey) => {
    const n = t[key];
    if (!n) return;
    const pct = t.holdingPct?.[key];
    parts.push(`${emoji} ${formatCount(n)}${pct !== undefined && pct >= 0.1 ? ` (${pctShort(pct)})` : ''}`);
  };
  item('🎯', 'sniper');
  item('🧑‍💻', 'dev');
  item('🐳', 'whale');
  item('🤖', 'bot');
  item('🧠', 'smartMoney');
  item('📣', 'kol');
  return parts;
}

function renderSecurityRows(sec: SecurityScan): string[] {
  const rows: string[] = [];

  const first: string[] = [];
  if (sec.buyTaxPct !== undefined || sec.sellTaxPct !== undefined) {
    first.push(`${sec.buyTaxPct?.toFixed(0) ?? '—'}% / ${sec.sellTaxPct?.toFixed(0) ?? '—'}%`);
  }
  if (sec.honeypotStatus) first.push(`Honeypot ${escapeHtml(sec.honeypotStatus)}`);
  if (first.length) rows.push(`${label('Tax')} ${first.join(' · ')}`);

  if (sec.items.length) {
    const hits = sec.items.filter((i) => i.hit);
    for (const it of hits.slice(0, 5)) {
      rows.push(`${it.level === 'r' ? '🚨' : it.level === 'y' ? '⚠️' : 'ℹ️'} ${escapeHtml(it.code)}`);
    }
    if (hits.length > 5) rows.push(`… ${hits.length - 5} more flagged`);
    const passed = sec.items.length - hits.length;
    if (passed > 0) rows.push(`✅ ${passed} checks passed`);
    return rows;
  }

  // GoPlus 布尔项（pairs/quotes 路径）
  const flags: string[] = [];
  const flag = (bad: string, ok: string, v: boolean | undefined) => {
    if (v !== undefined) flags.push(v ? `❌ ${bad}` : `✅ ${ok}`);
  };
  flag('Honeypot', 'Not a honeypot', sec.isHoneypot);
  flag('Sell restricted', 'Can sell all', sec.cannotSellAll);
  flag('Mintable', 'Not mintable', sec.isMintable);
  flag('Hidden owner', 'No hidden owner', sec.hiddenOwner);
  flag('Pausable', 'Not pausable', sec.transferPausable);
  flag('Has blacklist', 'No blacklist', sec.isBlacklisted);
  flag('Proxy', 'Not a proxy', sec.isProxy);
  if (sec.openSource !== undefined) flags.push(sec.openSource ? '✅ Open source' : '❌ Closed source');
  if (sec.ownerRenounced !== undefined) flags.push(sec.ownerRenounced ? '✅ Renounced' : '⚠️ Not renounced');
  for (let i = 0; i < flags.length; i += 3) rows.push(flags.slice(i, i + 3).join('  '));
  return rows;
}

/**
 * 池子行：`Pancake v2 / WBNB · $1.4M (91%) · 🔒 100%`，流动性数字链到该代币的 DexScan 页。
 * DexScan 没有单独的池子页（池子地址 404，/pair/ 重定向到首页，2026-09-05 实测），所以指向代币页的池子列表。
 * 链接里不能再嵌 <code>（Telegram 会拒绝解析），所以带链接的数字就是普通链接文本。
 */
function renderPoolRows(pools: PoolInfo[], dexscanUrl: string): string[] {
  const total = pools.reduce((s, x) => s + (x.liquidityUsd ?? 0), 0);
  return pools.slice(0, 3).map((pool, i) => {
    const name = `${escapeHtml(shortDex(pool.dexName ?? 'Unknown DEX'))}${pool.quoteSymbol ? ` / ${escapeHtml(pool.quoteSymbol)}` : ''}`;
    const liqText = link(formatUsdShort(pool.liquidityUsd), dexscanUrl);
    const share = i === 0 && total > 0 && pools.length > 1 && pool.liquidityUsd !== undefined ? ` (${Math.round((pool.liquidityUsd / total) * 100)}%)` : '';
    const extras: string[] = [];
    if (pool.lockedRatePct !== undefined) extras.push(`🔒 ${pool.lockedRatePct.toFixed(0)}%`);
    if (pool.burnedRatePct !== undefined) extras.push(`🔥 ${pool.burnedRatePct.toFixed(0)}%`);
    return `${name} · ${liqText}${share}${extras.length ? ` · ${extras.join(' / ')}` : ''}`;
  });
}

/**
 * Perps 区块。一行一个指标：
 *   OI      $9.8B · 12 venues
 *   Top     Binance 60% · OKX 16% · Bybit 12%
 *   Vol     $38.2B (3.2× spot)
 *   Funding +0.0064%/8h · +7.0% APR · Binance
 *   Liq 24h $108M · L $22M / S $86M
 * 任何一项缺失整行省略；perp 与 liquidations 都缺时返回空数组，调用方不渲染区块头。
 */
function renderPerpRows(perp: PerpStats | undefined, liq: LiquidationStats | undefined, spotVolumeUsd: number | undefined): string[] {
  const rows: string[] = [];
  if (perp && perp.openInterestUsd > 0) {
    const n = perp.venues.length;
    rows.push(`${label('OI')} ${formatUsdShort(perp.openInterestUsd)} · ${n} venue${n === 1 ? '' : 's'}`);
    const top = perp.venues
      .slice(0, PERP_TOP_VENUES)
      .filter((v) => v.openInterestUsd > 0)
      .map((v) => `${escapeHtml(v.name)} ${Math.round((v.openInterestUsd / perp.openInterestUsd) * 100)}%`);
    if (top.length > 1) rows.push(`${label('Top')} ${top.join(' · ')}`);
  }
  if (perp && perp.volume24hUsd > 0) {
    const ratio = formatRatio(perp.volume24hUsd, spotVolumeUsd);
    rows.push(`${label('Vol')} ${formatUsdShort(perp.volume24hUsd)}${ratio ? ` (${ratio} spot)` : ''}`);
  }
  if (perp?.funding) {
    const f = perp.funding;
    const period = f.intervalH === 8 ? '' : ` (${f.intervalH}h native)`;
    // 不能写 "/8h"：Telegram 会把 "/8h" 当成 bot 命令渲染成链接
    rows.push(`${label('Funding')} ${fundingEmoji(f.rate8h)} ${formatFunding(f.rate8h)} (8h) · ${formatApr(f.apr)} APR · ${escapeHtml(f.venue)}${period}`);
  }
  // 爆仓：多空分开，再给一个净方向。多单被爆得多 = 价格在跌 → 🔴；空单被爆得多 = 在涨 → 🟢；相等 Even
  const liqRow = (name: string, total?: number, long?: number, short?: number): string | undefined => {
    if (total === undefined || total <= 0) return undefined;
    if (long === undefined || short === undefined) return `${label(name)} ${formatUsdShort(total)}`;
    const net = long > short ? 'Net long 🔴' : short > long ? 'Net short 🟢' : 'Even';
    return `${label(name)} Long ${formatUsdShort(long)} · Short ${formatUsdShort(short)} · ${net}`;
  };
  for (const row of [liqRow('Liq 24h', liq?.total24hUsd, liq?.long24hUsd, liq?.short24hUsd), liqRow('Liq 1h', liq?.total1hUsd, liq?.long1hUsd, liq?.short1hUsd)]) {
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Spot 区块。一行一个指标：
 *   CEXs    127 (105 spot) · Binance, Coinbase, Upbit…
 *   Vol     $229.3M 🔴 −53.7% 24h
 *   Split   CEX $227.5M · DEX $1.8M · 99% CEX
 *   Top     Binance 25% · OKX 10% · Bybit 7%
 *   Premium CEX +0.2% vs DEX 🟢
 * 任一项缺失整行省略；全缺返回空数组，调用方不渲染区块头。
 */
function renderSpotRows(report: TokenReport, spot: SpotStats | undefined): string[] {
  const p = report.primary;
  const core = report.core;
  const rows: string[] = [];

  const cex = p.cexListings;
  if (cex && cex.length > 0) {
    const spotOnly = cex.filter((c) => c.categories.includes('SPOT'));
    const names = (spotOnly.length ? spotOnly : cex).slice(0, 3).map((c) => c.name);
    rows.push(`${label('CEXs')} ${cex.length}${spotOnly.length ? ` (${spotOnly.length} spot)` : ''} · ${escapeHtml(names.join(', '))}${cex.length > 3 ? '…' : ''}`);
  }
  if (core?.spotVolume24hUsd !== undefined && core.spotVolume24hUsd > 0) {
    const chg = core.volumeChange24hPct;
    rows.push(`${label('Vol')} ${formatUsdShort(core.spotVolume24hUsd)}${chg !== undefined ? ` ${changeEmoji(chg)} ${formatPercent(chg)} 24h` : ''}`);
  }
  const cexVol = core?.cexVolume24hUsd;
  const dexVol = core?.dexVolume24hUsd;
  if (cexVol !== undefined && cexVol > 0) {
    const cexShare = sharePct(cexVol, dexVol ?? 0);
    rows.push(`${label('Split')} CEX ${formatUsdShort(cexVol)} · DEX ${formatUsdShort(dexVol)}${cexShare !== undefined ? ` · ${cexShare}% CEX` : ''}`);
  }
  if (spot && spot.whitelistVolumeUsd > 0) {
    const top = spot.venues
      .slice(0, SPOT_TOP_VENUES)
      .map((v) => `${escapeHtml(v.name)} ${Math.round((v.volume24hUsd / spot.whitelistVolumeUsd) * 100)}%`);
    if (top.length) rows.push(`${label('Top')} ${top.join(' · ')}`);
  }
  const premium = spotPremiumPct(core?.priceUsd, p.priceUsd);
  if (premium !== undefined && Math.abs(premium) >= 0.05) {
    rows.push(`${label('Premium')} CEX ${formatPercent(premium)} vs DEX ${changeEmoji(premium)}`);
  }
  return rows;
}

function renderLinks(report: TokenReport): string {
  const p = report.primary;
  // 顺序：项目自己的渠道在前，工具链接在后（Website · X · TG · Explorer · Trade · DexScan）
  const items: string[] = [];
  if (p.website) items.push(link('Website', p.website));
  if (p.twitter) items.push(link('X', p.twitter));
  if (p.telegram) items.push(link('TG', p.telegram));
  const explorer = chainRegistry.explorerUrl(p.networkSlug, p.address);
  if (explorer) items.push(link('Explorer', explorer));
  if (p.tradeUrl) items.push(link('Trade', p.tradeUrl));
  items.push(link('DexScan', chainRegistry.dexscanUrl(p.networkSlug, p.address)));
  return `🔗 ${items.join(' · ')}`;
}
