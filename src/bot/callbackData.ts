import { randomBytes } from 'node:crypto';
import { CALLBACK_TOKEN_TTL_MS } from '../config/constants.js';
import { TtlCache } from '../infra/cache.js';

/** Telegram 对 callback_data 的硬限制是 64 字节。 */
const MAX_BYTES = 64;

/** perp：address 字段承载 cid 字符串（合约数据只认 cid）。 */
export type CallbackAction = 'scan' | 'refresh' | 'chain' | 'perp' | 'noop';

export interface CallbackPayload {
  action: CallbackAction;
  networkSlug?: string;
  address?: string;
  /** 仅用于占位文案（"Scanning TRIA · BNB Chain…"），可选；放不下 64 字节时会被丢弃。 */
  symbol?: string;
}

const store = new TtlCache<CallbackPayload>(CALLBACK_TOKEN_TTL_MS, 20_000);

const ACTION_CODE: Record<CallbackAction, string> = {
  scan: 's',
  refresh: 'r',
  chain: 'c',
  perp: 'p',
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
  // symbol 是锦上添花：能塞下就带上，塞不下就退回不带 symbol 的内联形式
  const withSymbol = payload.symbol ? `${base}|${payload.symbol}` : base;
  if (Buffer.byteLength(withSymbol, 'utf8') <= MAX_BYTES) return withSymbol;
  if (Buffer.byteLength(base, 'utf8') <= MAX_BYTES) return base;

  const token = `t|${randomBytes(8).toString('base64url')}`;
  store.set(token, payload);
  return token;
}

export function decodeCallback(data: string): CallbackPayload | null {
  if (data.startsWith('t|')) return store.get(data) ?? null;

  const [code, slug, address, symbol] = data.split('|');
  const action = code ? CODE_ACTION[code] : undefined;
  if (!action) return null;

  return {
    action,
    networkSlug: slug || undefined,
    address: address || undefined,
    symbol: symbol || undefined,
  };
}
