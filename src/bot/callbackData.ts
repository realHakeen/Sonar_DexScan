import { randomBytes } from 'node:crypto';
import { CALLBACK_TOKEN_TTL_MS } from '../config/constants.js';
import { TtlCache } from '../infra/cache.js';

/** Telegram 对 callback_data 的硬限制是 64 字节。 */
const MAX_BYTES = 64;

/**
 * perp 系列：perp = 从扫描卡原地打开；perp_refresh = 视图内刷新（保留正文只换按钮）；perp_pick = 候选选择（原地替换）。
 * 它们的 address 字段两用：带 networkSlug 或非纯数字时是代币定位（可回到卡片），纯数字时是 cid（/perp BTC 这类无合约的）。
 * back = 回到扫描卡：优先取渲染缓存，过期则按定位重扫。
 */
export type CallbackAction =
  | 'scan'
  | 'refresh'
  | 'chain'
  | 'perp'
  | 'perp_refresh'
  | 'perp_pick'
  | 'back'
  | 'port_add'
  | 'port_del'
  | 'port_scan'
  | 'port_refresh'
  | 'port_copy'
  /** watchlist 翻页：page = 目标页。 */
  | 'port_page'
  /** watchlist 切到删除模式（按钮变成 🗑 SYMBOL），page = 当前页。 */
  | 'port_edit'
  /** 删除模式下删一个并留在删除模式（port_del 是普通模式下的删除，留在普通模式）。 */
  | 'port_rm'
  /** 别人分享的 watchlist（深链版）翻页：address = shareId，page = 目标页。 */
  | 'port_spage'
  | 'noop';

export interface CallbackPayload {
  action: CallbackAction;
  networkSlug?: string;
  address?: string;
  /** 仅用于占位文案（"Scanning TRIA · BNB Chain…"），可选；放不下 64 字节时会被丢弃。 */
  symbol?: string;
  /** 原生币代理卡片（$NEAR → wrap.near）：重扫时身份仍按这个原生币 cid。 */
  native?: number;
  /** watchlist 页码（1 起始）：翻页 / 删除 / 刷新后留在当前页。 */
  page?: number;
}

const store = new TtlCache<CallbackPayload>(CALLBACK_TOKEN_TTL_MS, 20_000);

const ACTION_CODE: Record<CallbackAction, string> = {
  scan: 's',
  refresh: 'r',
  chain: 'c',
  perp: 'p',
  perp_refresh: 'pr',
  perp_pick: 'pc',
  back: 'b',
  port_add: 'wa',
  port_del: 'wd',
  port_scan: 'ws',
  port_refresh: 'wr',
  port_copy: 'wc',
  port_page: 'wp',
  port_spage: 'wsp',
  port_edit: 'we',
  port_rm: 'wx',
  noop: 'n',
};
const CODE_ACTION = Object.fromEntries(
  Object.entries(ACTION_CODE).map(([k, v]) => [v, k as CallbackAction]),
) as Record<string, CallbackAction>;

/**
 * 优先内联编码（重启后按钮依然可用）；
 * 超过 64 字节（Sui/Aptos 的 coin type 会超）时退回令牌表。
 */
export function encodeCallback(payload: CallbackPayload): string {
  const base = `${ACTION_CODE[payload.action]}|${payload.networkSlug ?? ''}|${payload.address ?? ''}`;
  // 第 5 段是原生币 cid（决定卡片身份）、第 6 段是 watchlist 页码，都不能丢；symbol 只是占位文案，塞不下就先丢 symbol
  const tail = `${payload.native !== undefined ? `|${payload.native}` : '|'}${payload.page !== undefined ? `|${payload.page}` : ''}`.replace(/\|+$/, '');
  const withSymbol = payload.symbol || tail ? `${base}|${payload.symbol ?? ''}${tail}` : base;
  if (Buffer.byteLength(withSymbol, 'utf8') <= MAX_BYTES) return withSymbol;
  const withoutSymbol = `${base}|${tail}`;
  if (tail && Buffer.byteLength(withoutSymbol, 'utf8') <= MAX_BYTES) return withoutSymbol;
  if (!tail && Buffer.byteLength(base, 'utf8') <= MAX_BYTES) return base;

  const token = `t|${randomBytes(8).toString('base64url')}`;
  store.set(token, payload);
  return token;
}

export function decodeCallback(data: string): CallbackPayload | null {
  if (data.startsWith('t|')) return store.get(data) ?? null;

  const [code, slug, address, symbol, native, page] = data.split('|');
  const action = code ? CODE_ACTION[code] : undefined;
  if (!action) return null;

  return {
    action,
    networkSlug: slug || undefined,
    address: address || undefined,
    symbol: symbol || undefined,
    ...(native && /^\d+$/.test(native) ? { native: Number(native) } : {}),
    ...(page && /^\d+$/.test(page) ? { page: Number(page) } : {}),
  };
}
