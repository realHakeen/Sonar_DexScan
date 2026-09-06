import { Resvg } from '@resvg/resvg-js';
import type { StatsSnapshot, StatsWindow } from '../services/statsService.js';
import { escapeHtml, formatCount, label, section, tree } from './format.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n = (v: number) => formatCount(v);
const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v * 100)}%`);

/** 触发方式的显示名与顺序。 */
const TRIGGER_LABEL: Array<[string, string]> = [
  ['address', 'address'],
  ['cashtag', '$ticker'],
  ['link', 'link'],
  ['forward', 'fwd'],
  ['name', 'name'],
  ['command', '/s'],
  ['refresh', 'refresh'],
  ['candidate', 'pick'],
  ['chain', 'chain'],
  ['back', 'back'],
  ['watchlist', 'watchlist'],
];

function triggerMix(w: StatsWindow): string {
  const total = Object.values(w.triggers).reduce((s, x) => s + x, 0);
  if (total === 0) return '';
  return TRIGGER_LABEL.filter(([k]) => w.triggers[k]).map(([k, name]) => `${name} ${Math.round((w.triggers[k]! / total) * 100)}%`).join(' · ');
}

/**
 * /stats 文字版（作为图片 caption，≤ 1024 字符）。三列：today · 7d · 30d，UTC 日。
 */
export function renderStatsText(s: StatsSnapshot, monthlyCreditLimit?: number): string {
  const t = s.today, w = s.d7, m = s.d30;
  const col = (f: (x: StatsWindow) => string) => `${f(t)} · ${f(w)} · ${f(m)}`;
  const rows: string[] = [
    `${label('Users')} ${col((x) => n(x.users))}`,
    `${label('Groups')} ${col((x) => n(x.groups))}  (in ${n(s.groupsTotal)})`,
    `${label('New')} ${col((x) => `${n(x.newUsers)}u/${n(x.newGroups)}g`)}`,
    `${label('Scans')} ${col((x) => n(x.scans))}`,
  ];
  const mix = triggerMix(m);
  if (mix) rows.push(`${label('')} ${mix}`);
  rows.push(`${label('Retain')} D1 ${pct(s.retentionD1)} · D7 ${pct(s.retentionD7)}`);
  rows.push(`${label('Watch')} +${col((x) => n(x.watchAdds))}`);
  rows.push(`${label('Share')} ${n(m.shares)} → opened ${n(m.shareOpens)} → copied ${n(m.shareCopies)} (30d)`);
  rows.push(`${label('Perps')} /perp ${n(m.perpCommands)} · button ${n(m.perpButtons)} (30d)`);
  const health: string[] = [];
  if (w.avgElapsedMs !== undefined) health.push(`${(w.avgElapsedMs / 1000).toFixed(1)}s avg`);
  if (w.degradedRate !== undefined) health.push(`${Math.round(w.degradedRate * 100)}% degraded`);
  if (w.rateLimited) health.push(`${n(w.rateLimited)} throttled`);
  if (health.length) rows.push(`${label('Health')} ${health.join(' · ')} (7d)`);
  const limitNote = monthlyCreditLimit ? ` (${Math.round((m.credits / monthlyCreditLimit) * 100)}% of ${n(monthlyCreditLimit)})` : '';
  rows.push(`${label('Credits')} ${n(t.credits)} today · ${n(m.credits)} 30d${limitNote}`);
  const out = [`${section('📊', 'Stats')}  today · 7d · 30d (UTC)`, ...tree(rows)];
  if (s.topTokens.length) out.push('', `<i>Top 7d: ${escapeHtml(s.topTokens.slice(0, 5).map((x) => `${x.token.split(':').pop()} ${x.scans}`).join(' · '))}</i>`);
  return out.join('\n');
}

const W = 1000;
const H = 520;
const C = { bg: '#0B1220', grid: '#1E293B', text: '#E2E8F0', muted: '#7C8AA5', bar: '#334155', line: '#38BDF8', accent: '#22C55E', warn: '#F59E0B' };
const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';

/**
 * /stats 图：上半部 30 天每日扫描柱 + 活跃用户折线；下半部分享漏斗 + 触发方式占比。
 */
export function renderStatsSvg(s: StatsSnapshot): string {
  const daily = s.daily;
  const top = { x: 60, y: 60, w: W - 120, h: 250 };
  const maxScans = Math.max(1, ...daily.map((d) => d.scans));
  const maxUsers = Math.max(1, ...daily.map((d) => d.users));
  const bw = top.w / daily.length;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  parts.push(`<text x="60" y="36" font-family="${FONT}" font-size="22" font-weight="bold" fill="${C.text}">Last 30 days</text>`);
  parts.push(`<text x="${W - 60}" y="36" text-anchor="end" font-family="${FONT}" font-size="14" fill="${C.muted}"><tspan fill="${C.bar}">■</tspan> scans   <tspan fill="${C.line}">—</tspan> active users</text>`);
  // grid + bars
  for (let i = 0; i <= 4; i++) {
    const y = top.y + (top.h * i) / 4;
    parts.push(`<line x1="${top.x}" y1="${y}" x2="${top.x + top.w}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${top.x - 8}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${C.muted}">${Math.round(maxScans * (1 - i / 4))}</text>`);
    parts.push(`<text x="${top.x + top.w + 8}" y="${y + 4}" font-family="${FONT}" font-size="11" fill="${C.line}">${Math.round(maxUsers * (1 - i / 4))}</text>`);
  }
  daily.forEach((d, i) => {
    const h = (d.scans / maxScans) * top.h;
    parts.push(`<rect x="${(top.x + i * bw + 2).toFixed(1)}" y="${(top.y + top.h - h).toFixed(1)}" width="${Math.max(1, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" fill="${C.bar}" rx="2"/>`);
  });
  const pts = daily.map((d, i) => `${(top.x + i * bw + bw / 2).toFixed(1)},${(top.y + top.h - (d.users / maxUsers) * top.h).toFixed(1)}`);
  if (pts.length > 1) parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${C.line}" stroke-width="2.5" stroke-linejoin="round"/>`);
  daily.forEach((d, i) => {
    if (i % 5 === 0 || i === daily.length - 1) {
      const date = new Date(d.day * 86_400_000);
      parts.push(`<text x="${(top.x + i * bw + bw / 2).toFixed(1)}" y="${top.y + top.h + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${C.muted}">${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}</text>`);
    }
  });
  // funnel
  const fy = 370;
  const funnel = [
    ['Shares', s.d30.shares],
    ['Opened', s.d30.shareOpens],
    ['Copied', s.d30.shareCopies],
  ] as const;
  const fmax = Math.max(1, ...funnel.map(([, v]) => v));
  parts.push(`<text x="60" y="${fy - 12}" font-family="${FONT}" font-size="14" fill="${C.muted}">Watchlist share funnel (30d)</text>`);
  funnel.forEach(([name, v], i) => {
    const y = fy + i * 34;
    const w = (v / fmax) * 300;
    parts.push(`<text x="60" y="${y + 15}" font-family="${FONT}" font-size="13" fill="${C.text}">${name}</text>`);
    parts.push(`<rect x="130" y="${y}" width="${Math.max(2, w).toFixed(1)}" height="22" fill="${C.accent}" fill-opacity="${1 - i * 0.25}" rx="3"/>`);
    parts.push(`<text x="${(136 + Math.max(2, w)).toFixed(1)}" y="${y + 15}" font-family="${FONT}" font-size="13" fill="${C.text}">${v}</text>`);
  });
  // trigger mix
  const total = Object.values(s.d30.triggers).reduce((a, b) => a + b, 0);
  parts.push(`<text x="540" y="${fy - 12}" font-family="${FONT}" font-size="14" fill="${C.muted}">How scans are triggered (30d)</text>`);
  const palette = ['#38BDF8', '#22C55E', '#F59E0B', '#A78BFA', '#F472B6', '#94A3B8', '#FB7185', '#34D399', '#FBBF24', '#60A5FA', '#C084FC'];
  let x = 540;
  const entries = TRIGGER_LABEL.filter(([k]) => s.d30.triggers[k]).map(([k, name]) => [name, s.d30.triggers[k]!] as const);
  entries.forEach(([, v], i) => {
    const w = total ? (v / total) * 400 : 0;
    parts.push(`<rect x="${x.toFixed(1)}" y="${fy}" width="${w.toFixed(1)}" height="22" fill="${palette[i % palette.length]}"/>`);
    x += w;
  });
  entries.slice(0, 8).forEach(([name, v], i) => {
    const lx = 540 + (i % 4) * 100;
    const ly = fy + 48 + Math.floor(i / 4) * 22;
    parts.push(`<rect x="${lx}" y="${ly - 10}" width="10" height="10" fill="${palette[i % palette.length]}"/>`);
    parts.push(`<text x="${lx + 16}" y="${ly}" font-family="${FONT}" font-size="12" fill="${C.text}">${esc(name)} ${total ? Math.round((v / total) * 100) : 0}%</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

export function renderStatsPng(s: StatsSnapshot): Buffer {
  return Buffer.from(new Resvg(renderStatsSvg(s), { fitTo: { mode: 'width', value: W } }).render().asPng());
}
