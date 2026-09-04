import { chainRegistry } from '../domain/chains.js';
import { overallRisk } from '../domain/risk.js';
import type { PoolInfo, SecurityScan, TokenReport } from '../domain/types.js';
import {
  bar,
  bold,
  changeEmoji,
  code,
  escapeHtml,
  formatAge,
  formatCount,
  formatPercent,
  formatPrice,
  formatRatio,
  formatUsd,
  formatUsdShort,
  label,
  link,
  pctShort,
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
  out.push(`${bold(`${p.symbol}${p.officialVerified ? ' ✅' : ''}`)} · ${escapeHtml(p.name)}`);
  const meta: string[] = [`⛓ ${escapeHtml(chain.name)}`];
  const rank = report.core?.cmcRank ?? p.cmcRank;
  if (rank) meta.push(`🏅 #${rank}`);
  const age = formatAge(p.listedAt);
  if (age !== '—') meta.push(`🕐 ${age}`);
  if (p.ownerRenounced === true) meta.push('🔐 Renounced');
  out.push(meta.join(' · '));
  const cex = renderCex(p.cexListings);
  if (cex) out.push(cex);
  if (report.core?.categories.length) {
    const cats = report.core.categories.map((c) => c.replace(/\s+Ecosystem$/i, '')).slice(0, 3);
    out.push(`🏷 ${escapeHtml(cats.join(' / '))}`);
  }
  out.push(code(p.address));

  // ── Market ──（按手机 ~36 列设计，每行一个概念）
  out.push('', bold('📊 Market'));
  const market: string[] = [];
  market.push(`${label('Price')} ${bold(formatPrice(p.priceUsd))}  ${changeEmoji(p.priceChange24hPct)} ${formatPercent(p.priceChange24hPct)}`);

  // 口径说明：
  // - MC 来自主 API，是该币在**全部链**部署加总的流通市值
  // - FDV 来自 DEX token 接口，是**当前链**的 price × 该链总供应
  // 多链代币两者明显不一致时拆成三行并标明口径
  const chainFdv = p.fdvUsd;
  const coreFdv = report.core?.fdvUsd;
  const fdv = chainFdv ?? coreFdv;
  const mcap = report.core?.marketCapUsd ?? p.listingMarketCapUsd;
  if (mcap !== undefined) {
    const multiChain =
      chainFdv !== undefined && coreFdv !== undefined && coreFdv > 0 && Math.abs(coreFdv - chainFdv) / coreFdv > 0.05;
    const fdvForCirc = coreFdv ?? chainFdv;
    const circ = fdvForCirc && fdvForCirc > 0 ? Math.round((mcap / fdvForCirc) * 100) : undefined;
    const circText = circ !== undefined && circ < 100 ? ` (${circ}% circ.)` : '';
    if (multiChain) {
      market.push(`${label('MC')} ${formatUsdShort(mcap)} all chains${circText}`);
      market.push(`${label('FDV')} ${formatUsdShort(coreFdv)} all chains`);
      market.push(`${label('FDV')} ${formatUsdShort(chainFdv)} ${escapeHtml(chain.name)}`);
    } else {
      market.push(`${label('MC')} ${formatUsdShort(mcap)} · FDV ${formatUsdShort(fdv)}${circText}`);
    }
  } else {
    market.push(`${label('FDV')} ${formatUsdShort(fdv)}`);
  }

  const volLiq = formatRatio(p.volume24hUsd, p.liquidityUsd);
  market.push(`${label('Liq')} ${formatUsdShort(p.liquidityUsd)} · Vol ${formatUsdShort(p.volume24hUsd)}${volLiq ? ` (${volLiq})` : ''}`);

  if (p.traders24h !== undefined || p.buys24h !== undefined) {
    const parts: string[] = [];
    if (p.traders24h !== undefined) parts.push(formatCount(p.traders24h));
    if (p.buys24h !== undefined || p.sells24h !== undefined) parts.push(`↑${formatCount(p.buys24h)} ↓${formatCount(p.sells24h)}`);
    else if (p.txns24h !== undefined) parts.push(`${formatCount(p.txns24h)} txns`);
    market.push(`${label('Trades')} ${parts.join(' · ')}`);
  }

  if (p.buyVolume24hUsd !== undefined || p.sellVolume24hUsd !== undefined) {
    const pressure = sharePct(p.buyVolume24hUsd, p.sellVolume24hUsd);
    market.push(`${label('Flow')} +${formatUsdShort(p.buyVolume24hUsd)} / −${formatUsdShort(p.sellVolume24hUsd)}${pressure !== undefined ? ` · ${pressure}% buy` : ''}`);
  }
  out.push(...tree(market));

  // ── Holders ──
  const h = report.holders;
  const t = report.tags;
  if (h || t) {
    const total = h?.totalHolders !== undefined ? `  ${formatCount(h.totalHolders)}` : '';
    out.push('', `${bold('👥 Holders')}${total}`);
    const rows: string[] = [];
    if (h?.top10Pct !== undefined) rows.push(`${label('Top10')} ${bar(h.top10Pct)} ${pctShort(h.top10Pct)}`);
    if (h?.top50Pct !== undefined) rows.push(`${label('Top50')} ${bar(h.top50Pct)} ${pctShort(h.top50Pct)}`);
    const tags = renderTags(t);
    // 超过两个标签就拆两行，第二行标签位留空对齐
    if (tags.length) rows.push(`${label('Tags')} ${tags.slice(0, 2).join(' · ')}`);
    if (tags.length > 2) rows.push(`${label('')} ${tags.slice(2).join(' · ')}`);
    out.push(...tree(rows));
  }

  // ── Security ──
  const sec = report.security;
  if (sec) {
    const head = [bold('🛡 Security'), escapeHtml(sec.provider)];
    if (sec.level) head.push(escapeHtml(sec.level));
    out.push('', head.join(' · '));
    out.push(...tree(renderSecurityRows(sec)));
  }

  // ── Pools ──
  if (report.pools.length) {
    // 上游可能只返回前几个池子（pls）但报告总数（nps）
    const total = Math.max(p.poolCount ?? 0, report.pools.length);
    out.push('', bold(`💧 Pools (${total})`));
    out.push(...tree(renderPoolRows(report.pools)));
  }

  // ── Risks ──
  const risks = visibleRisks(report);
  if (risks.length) {
    out.push('', bold(RISK_HEADER[overallRisk(report.risks)] ?? 'Risks'));
    out.push(...tree(risks.slice(0, 8).map((r) => escapeHtml(r.message))));
  }

  // ── Links ──
  out.push('', renderLinks(report));
  if (report.degraded.length) {
    const names = [...new Set(report.degraded.map((d) => DEGRADED_LABEL[d] ?? d))];
    out.push(`<i>⚠️ Partial data — unavailable: ${escapeHtml(names.join(', '))}. Tap Refresh to retry.</i>`);
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

function renderPoolRows(pools: PoolInfo[]): string[] {
  const total = pools.reduce((s, x) => s + (x.liquidityUsd ?? 0), 0);
  return pools.slice(0, 3).map((pool, i) => {
    const name = `${escapeHtml(shortDex(pool.dexName ?? 'Unknown DEX'))}${pool.quoteSymbol ? ` / ${escapeHtml(pool.quoteSymbol)}` : ''}`;
    const share = i === 0 && total > 0 && pools.length > 1 && pool.liquidityUsd !== undefined ? ` ${Math.round((pool.liquidityUsd / total) * 100)}%` : '';
    const extras: string[] = [];
    if (pool.lockedRatePct !== undefined) extras.push(`🔒${pool.lockedRatePct.toFixed(0)}%`);
    if (pool.burnedRatePct !== undefined) extras.push(`🔥${pool.burnedRatePct.toFixed(0)}%`);
    return `${name}  ${formatUsdShort(pool.liquidityUsd)}${share}${extras.length ? ` ${extras.join(' ')}` : ''}`;
  });
}

function renderCex(cex: TokenReport['primary']['cexListings']): string | undefined {
  if (!cex || cex.length === 0) return undefined;
  const spot = cex.filter((c) => c.categories.includes('SPOT'));
  const names = (spot.length ? spot : cex).slice(0, 3).map((c) => c.name);
  return `🏦 ${cex.length} CEXs${spot.length ? ` (${spot.length} spot)` : ''} · ${escapeHtml(names.join(', '))}${cex.length > 3 ? '…' : ''}`;
}

function renderLinks(report: TokenReport): string {
  const p = report.primary;
  const items: string[] = [link('DexScan', chainRegistry.dexscanUrl(p.networkSlug, p.address))];
  const explorer = chainRegistry.explorerUrl(p.networkSlug, p.address);
  if (explorer) items.push(link('Explorer', explorer));
  if (p.tradeUrl) items.push(link('Trade', p.tradeUrl));
  if (p.website) items.push(link('Website', p.website));
  if (p.twitter) items.push(link('X', p.twitter));
  if (p.telegram) items.push(link('TG', p.telegram));
  return `🔗 ${items.join(' · ')}`;
}

/** 群聊里的紧凑版本：4 行。 */
export function renderCompactCard(report: TokenReport): string {
  const p = report.primary;
  const chain = chainRegistry.get(p.networkSlug);
  const risk = overallRisk(report.risks);
  const mcap = report.core?.marketCapUsd ?? p.listingMarketCapUsd;
  const topRisk = [...report.risks].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])[0];

  const lines = [
    `${bold(`${p.symbol}${p.officialVerified ? ' ✅' : ''}`)} · ${escapeHtml(chain.name)}${risk === 'danger' ? '  🚨' : risk === 'warn' ? '  ⚠️' : ''}`,
    `${bold(formatPrice(p.priceUsd))}  ${changeEmoji(p.priceChange24hPct)} ${formatPercent(p.priceChange24hPct)}`,
    `${mcap !== undefined ? `MC ${formatUsdShort(mcap)}` : `FDV ${formatUsdShort(p.fdvUsd)}`} · Liq ${formatUsdShort(p.liquidityUsd)} · Vol ${formatUsdShort(p.volume24hUsd)}`,
  ];
  if (topRisk) lines.push(escapeHtml(topRisk.message));
  lines.push(`${code(shortenAddress(p.address, 8, 6))} · ${link('DexScan', chainRegistry.dexscanUrl(p.networkSlug, p.address))}`);
  return lines.join('\n');
}
