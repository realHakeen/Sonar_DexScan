/**
 * 端点探针。逐个打真实端点，打印 HTTP 状态、耗时、credits 与响应字段名。
 *   npm run probe -- <代币地址> [platform]
 *   npm run probe -- 0xdAC17F958D2ee523a2206206994597C13D831ec7
 *   npm run probe -- DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
 * platform 缺省时从 search 结果的 plt 取。
 */
import { env } from '../src/config/env.js';
import { ENDPOINTS } from '../src/api/cmc/endpoints.js';

const address = process.argv[2] ?? '0xdAC17F958D2ee523a2206206994597C13D831ec7';

async function probe(
  label: string,
  path: string,
  query: Record<string, string | number>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(path, env.CMC_BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-CMC_PRO_API_KEY': env.CMC_API_KEY,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const elapsed = Date.now() - started;

    if (!res.ok) {
      console.log(`\n❌ ${label}  HTTP ${res.status}  ${elapsed}ms\n   ${path}\n   ${text.slice(0, 300)}`);
      return undefined;
    }
    const json = JSON.parse(text) as { data?: unknown; status?: { credit_count?: number; error_message?: string } };
    if (json.status?.error_message) {
      console.log(`\n❌ ${label}  ${json.status.error_message}\n   ${path}`);
      return undefined;
    }
    const payload = 'data' in json ? json.data : json;
    const sample = firstRecord(payload);
    console.log(
      `\n✅ ${label}  HTTP 200  ${elapsed}ms  credits=${json.status?.credit_count ?? '?'}\n` +
        `   ${path}\n   fields: ${sample ? Object.keys(sample).join(', ') : '(empty)'}`,
    );
    if (sample) console.log(`   sample: ${JSON.stringify(sample).slice(0, 500)}`);
    return payload;
  } catch (err) {
    console.log(`\n💥 ${label}  ${String(err)}`);
    return undefined;
  }
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const v of Object.values(obj)) if (Array.isArray(v) && v.length) return v[0] as Record<string, unknown>;
    return obj;
  }
  return null;
}

const search = await probe('dex.search', ENDPOINTS.dex.search, { q: address, limit: 5 });
const platform = process.argv[3] ?? (firstRecord(search)?.['plt'] as string | undefined);
if (!platform) {
  console.log('\n⚠️ search returned nothing and no platform was given; skipping the rest. Usage: npm run probe -- <address> <platform>');
  process.exit(0);
}
console.log(`\nplatform = ${platform}`);

const v1 = { platform, address };
const detail = await probe('dex.tokenDetail', ENDPOINTS.dex.tokenDetail, v1);
const cid = (detail as Record<string, unknown> | undefined)?.['cid'] as number | undefined;
await probe('dex.tokenPools', ENDPOINTS.dex.tokenPools, { ...v1, size: 3 });
await probe('dex.securityDetail', ENDPOINTS.dex.securityDetail, { platformName: platform, address });

const holders = { platform, tokenAddress: address };
await probe('dex.holdersCount', ENDPOINTS.dex.holdersCount, holders);
await probe('dex.holdersTrendList', ENDPOINTS.dex.holdersTrendList, { ...holders, interval: '1d', limit: 2 });
await probe('dex.holdersTagCount', ENDPOINTS.dex.holdersTagCount, holders);
await probe('dex.holdersList (POST)', ENDPOINTS.dex.holdersList, {}, { ...holders, tag: 'tag_all' });

await probe('core.map', ENDPOINTS.core.map, { symbol: String(firstRecord(search)?.['s'] ?? 'USDT'), aux: 'platform', limit: 5 });
if (cid) await probe('core.quotes', ENDPOINTS.core.quotes, { id: cid, convert: 'USD' });

console.log('\nDone. If a field does not line up, add the alias to src/api/cmc/mappers.ts.');
