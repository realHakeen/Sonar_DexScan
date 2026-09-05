import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { formatCallAge, formatMultiple } from '../domain/calls.js';
import { formatUsdShort } from './format.js';

export interface BannerInput {
  symbol: string;
  multiple: number;
  calledMcapUsd: number;
  calledAt: number;
  callerName: string;
  /** data: URI，可选：喊单人没有头像时画首字母圆标。 */
  logoDataUri?: string;
  now?: number;
}

const W = 1200;
const H = 796;
const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let bgCache: string | undefined;
/** 背景 JPEG 在 assets/ 下（Dockerfile 会复制），转成 data URI 后进程内缓存。 */
function background(): string {
  if (!bgCache) {
    const buf = readFileSync(new URL('../../assets/banner-bg.jpg', import.meta.url));
    bgCache = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return bgCache;
}

/**
 * 里程碑横幅：左侧 $SYMBOL / 大号倍数 / Called at 市值 · 时长 / 喊单人名牌，右侧是背景自带的奖杯。
 * 倍数字号按位数缩，"100.0x" 也放得下。
 */
export function renderBannerSvg(input: BannerInput): string {
  const multiple = formatMultiple(input.multiple);
  const sizeMultiple = multiple.length <= 5 ? 170 : multiple.length <= 6 ? 140 : 120;
  const symbol = `$${input.symbol.toUpperCase()}`;
  const sizeSymbol = symbol.length <= 10 ? 64 : symbol.length <= 14 ? 48 : 36;
  const sub = `Called at ${formatUsdShort(input.calledMcapUsd)}   ·   ${formatCallAge(input.calledAt, input.now)} ago`;
  const name = input.callerName.length > 24 ? `${input.callerName.slice(0, 23)}…` : input.callerName;
  const chipW = Math.min(W - 160, 110 + name.length * 17);
  const initial = name.replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
  const avatar = input.logoDataUri
    ? `<clipPath id="av"><circle cx="118" cy="662" r="18"/></clipPath><image href="${input.logoDataUri}" x="100" y="644" width="36" height="36" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="118" cy="662" r="18" fill="#3b82f6"/><text x="118" y="670" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#fff">${esc(initial)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<image href="${background()}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
<text x="80" y="330" font-family="${FONT}" font-weight="bold" font-size="${sizeSymbol}" fill="#ffffff">${esc(symbol)}</text>
<text x="76" y="500" font-family="${FONT}" font-weight="bold" font-size="${sizeMultiple}" fill="#ffffff">${esc(multiple)}</text>
<text x="80" y="570" font-family="${FONT}" font-size="30" fill="#dbe8ff">${esc(sub)}</text>
<rect x="80" y="630" rx="10" ry="10" width="${chipW}" height="64" fill="#0b1a3a" fill-opacity="0.85"/>
${avatar}
<text x="150" y="672" font-family="${FONT}" font-weight="bold" font-size="30" fill="#ffffff">${esc(name)}</text>
</svg>`;
}

export function renderBannerPng(input: BannerInput): Buffer {
  const resvg = new Resvg(renderBannerSvg(input), { fitTo: { mode: 'width', value: W } });
  return Buffer.from(resvg.render().asPng());
}
