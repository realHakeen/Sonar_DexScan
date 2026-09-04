import { Resvg } from '@resvg/resvg-js';
import type { Candle } from '../domain/types.js';
import { formatPrice, formatUsdShort } from './format.js';

export interface ChartInput {
  symbol: string;
  chainName: string;
  /** 'm' 市值口径（Y 轴显示 $xxM），'p' 价格口径。 */
  mode: 'p' | 'm';
  intervalLabel: string;
  candles: Candle[];
  /** 头部附加信息 */
  priceUsd?: number;
  fdvUsd?: number;
  change24hPct?: number;
  liquidityUsd?: number;
}

const W = 1000;
const H = 500;
const PAD = { top: 74, right: 96, bottom: 44, left: 16 };
const VOL_H = 70;

const C = {
  bg: '#0B1220',
  panel: '#0F172A',
  grid: '#1E293B',
  text: '#E2E8F0',
  muted: '#7C8AA5',
  up: '#22C55E',
  down: '#EF4444',
  ath: '#F59E0B',
  accent: '#38BDF8',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmtY(v: number, mode: 'p' | 'm'): string {
  return mode === 'm' ? formatUsdShort(v) : formatPrice(v);
}

function fmtTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return spanMs > 2 * 86400_000 ? `${mm}-${dd}` : `${mm}-${dd} ${hh}:${mi}`;
}

/** 选一组"好看"的 Y 轴刻度：4–6 条。 */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(v);
  return ticks;
}

/** 画 SVG。纯字符串拼接，没有 DOM 依赖，方便单测。 */
export function renderChartSvg(input: ChartInput): string {
  const { candles, mode } = input;
  const n = candles.length;
  const plotX0 = PAD.left;
  const plotX1 = W - PAD.right;
  const plotW = plotX1 - plotX0;
  const priceY0 = PAD.top;
  const priceY1 = H - PAD.bottom - VOL_H - 10;
  const volY0 = priceY1 + 10;
  const volY1 = H - PAD.bottom;

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  const range = max - min || max * 0.1 || 1;
  min -= range * 0.06;
  max += range * 0.1;
  const y = (v: number) => priceY1 - ((v - min) / (max - min)) * (priceY1 - priceY0);

  const maxVol = Math.max(1, ...candles.map((c) => c.volumeUsd));
  const slot = plotW / Math.max(n, 1);
  const bodyW = Math.max(2, Math.min(14, slot * 0.66));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

  // ── 头部 ──
  const last = candles[n - 1]!;
  const first = candles[0]!;
  // 未传 24h 涨跌时，用窗口首根 open → 末根 close，并在标签里注明是整个窗口的涨跌
  const windowChg = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
  const chg = input.change24hPct ?? windowChg;
  const chgLabel = input.change24hPct !== undefined ? '24h' : input.intervalLabel.split('·').pop()?.trim() ?? '';
  const chgColor = chg >= 0 ? C.up : C.down;
  parts.push(
    `<text x="${plotX0 + 4}" y="32"><tspan fill="${C.text}" font-size="26" font-weight="bold">${esc(input.symbol)}</tspan>` +
      `<tspan dx="14" fill="${C.muted}" font-size="16">${esc(input.chainName)}</tspan></text>`,
  );
  const headItems: string[] = [];
  if (input.fdvUsd !== undefined) headItems.push(`FDV ${formatUsdShort(input.fdvUsd)}`);
  if (input.priceUsd !== undefined) headItems.push(`Price ${formatPrice(input.priceUsd)}`);
  if (input.liquidityUsd !== undefined) headItems.push(`Liq ${formatUsdShort(input.liquidityUsd)}`);
  parts.push(`<text x="${plotX0 + 4}" y="58" fill="${C.muted}" font-size="15">${esc(headItems.join('   ·   '))}</text>`);
  parts.push(
    `<text x="${plotX1}" y="32" text-anchor="end"><tspan fill="${chgColor}" font-size="22" font-weight="bold">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</tspan>` +
      `<tspan dx="8" fill="${C.muted}" font-size="14">${esc(chgLabel)}</tspan></text>`,
  );
  parts.push(`<text x="${plotX1}" y="58" fill="${C.muted}" font-size="14" text-anchor="end">${esc(input.intervalLabel)} · ${mode === 'm' ? 'Market cap (FDV)' : 'Price'} · CoinMarketCap DEX</text>`);

  // ── 网格 + Y 轴 ──
  for (const t of niceTicks(min, max)) {
    const yy = y(t);
    if (yy < priceY0 || yy > priceY1) continue;
    parts.push(`<line x1="${plotX0}" x2="${plotX1}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${plotX1 + 8}" y="${(yy + 5).toFixed(1)}" fill="${C.muted}" font-size="13">${esc(fmtY(t, mode))}</text>`);
  }

  // ── ATH ──
  const athIdx = highs.indexOf(Math.max(...highs));
  const ath = candles[athIdx]!;
  const athY = y(ath.high);
  parts.push(`<line x1="${plotX0}" x2="${plotX1}" y1="${athY.toFixed(1)}" y2="${athY.toFixed(1)}" stroke="${C.ath}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>`);
  const athX = plotX0 + athIdx * slot + slot / 2;
  const athLabel = `ATH ${fmtY(ath.high, mode)}`;
  const labelW = athLabel.length * 7.5 + 12;
  const athLabelX = Math.min(Math.max(athX - labelW / 2, plotX0), plotX1 - labelW);
  parts.push(`<rect x="${athLabelX.toFixed(1)}" y="${(athY - 22).toFixed(1)}" width="${labelW.toFixed(1)}" height="18" rx="3" fill="${C.ath}"/>`);
  parts.push(`<text x="${(athLabelX + labelW / 2).toFixed(1)}" y="${(athY - 9).toFixed(1)}" fill="#111827" font-size="12" font-weight="bold" text-anchor="middle">${esc(athLabel)}</text>`);

  // ── 蜡烛 + 成交量 ──
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const cx = plotX0 + i * slot + slot / 2;
    const up = c.close >= c.open;
    const color = up ? C.up : C.down;
    const yo = y(c.open), yc = y(c.close), yh = y(c.high), yl = y(c.low);
    const top = Math.min(yo, yc);
    const h = Math.max(1, Math.abs(yo - yc));
    parts.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${yh.toFixed(1)}" y2="${yl.toFixed(1)}" stroke="${color}" stroke-width="1"/>`);
    parts.push(`<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"/>`);
    const vh = (c.volumeUsd / maxVol) * (volY1 - volY0);
    parts.push(`<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${(volY1 - vh).toFixed(1)}" width="${bodyW.toFixed(1)}" height="${vh.toFixed(1)}" fill="${color}" opacity="0.45"/>`);
  }

  // ── 最新价标签 ──
  const lastY = y(last.close);
  const lastLabel = fmtY(last.close, mode);
  parts.push(`<rect x="${plotX1 + 4}" y="${(lastY - 10).toFixed(1)}" width="${PAD.right - 8}" height="20" rx="3" fill="${chgColor}"/>`);
  parts.push(`<text x="${plotX1 + 4 + (PAD.right - 8) / 2}" y="${(lastY + 5).toFixed(1)}" fill="#0B1220" font-size="12" font-weight="bold" text-anchor="middle">${esc(lastLabel)}</text>`);

  // ── X 轴 ──
  const span = last.ts - first.ts;
  const xTicks = 5;
  for (let k = 0; k <= xTicks; k++) {
    const idx = Math.min(n - 1, Math.round((k / xTicks) * (n - 1)));
    const cx = plotX0 + idx * slot + slot / 2;
    parts.push(`<text x="${cx.toFixed(1)}" y="${H - 14}" fill="${C.muted}" font-size="12" text-anchor="${k === 0 ? 'start' : k === xTicks ? 'end' : 'middle'}">${esc(fmtTime(candles[idx]!.ts, span))}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/** SVG → PNG。alpine 镜像需要 ttf-dejavu；macOS / 大多数 Linux 桌面自带可用字体。 */
export function renderChartPng(input: ChartInput): Buffer {
  const svg = renderChartSvg(input);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    background: C.bg,
  });
  return resvg.render().asPng();
}

/** 蜡烛太少画不出图。 */
export function hasEnoughCandles(candles: Candle[]): boolean {
  return candles.length >= 4;
}

/**
 * 上游偶尔给出 low=0 或离群到 0 的坏蜡烛（实测 MarsCoin 08-28 有一根打到 0），
 * 会把整张图的 Y 轴拉垮。规则：open/close ≤ 0 的丢弃；low/high 偏离本根实体超过 50 倍的视为坏点，钳到实体。
 */
export function sanitizeCandles(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (!(c.open > 0) || !(c.close > 0)) continue;
    const bodyHi = Math.max(c.open, c.close);
    const bodyLo = Math.min(c.open, c.close);
    const high = c.high > 0 && c.high <= bodyHi * 50 ? Math.max(c.high, bodyHi) : bodyHi;
    const low = c.low > 0 && c.low >= bodyLo / 50 ? Math.min(c.low, bodyLo) : bodyLo;
    out.push({ ...c, high, low });
  }
  return out;
}
