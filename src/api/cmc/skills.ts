import { env } from '../../config/env.js';
import { creditMeter } from '../../infra/creditMeter.js';
import { createLogger } from '../../infra/logger.js';

const log = createLogger('cmcSkills');

/**
 * CMC Agent Hub 的 skill（云端分析服务）。走 MCP 端点，但只是一个 JSON-RPC POST，不需要客户端库：
 * 实测 2026-09-10 不用 initialize / session 也能直接 tools/call，返回是 SSE 文本（`data:{…}` 行）。
 * 计费：每次运行 20 credits（走 API key 的 2M 池），耗时 14–50s，失败也扣。
 */
export interface SkillResult {
  ok: boolean;
  status?: string;
  confidence?: string;
  title?: string;
  conclusion?: string;
  analysis?: string;
  elapsedMs?: number;
}

/** SSE 或裸 JSON → 最后一条 JSON-RPC 消息。 */
export function parseRpcBody(body: string): unknown {
  const t = body.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  let last: unknown;
  for (const line of t.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      last = JSON.parse(line.slice(5).trim());
    } catch {
      /* 非 JSON 的 data 行跳过 */
    }
  }
  return last;
}

/** execute_skill 的 result 外壳 → 关心的字段。上游有两种形态：{result:{ok,data:{data:{…}}}} 和 {result:{output:"<json string>"}}。 */
export function parseSkillPayload(rpc: unknown): SkillResult {
  const text = (rpc as { result?: { content?: Array<{ type?: string; text?: string }> } })?.result?.content?.find((c) => c.type === 'text')?.text;
  if (!text) return { ok: false };
  let outer: any;
  try {
    outer = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const elapsedMs = Number(outer?.executionMeta?.executionTimeMs) || undefined;
  let pack: any = outer?.result?.data;
  if (!pack && typeof outer?.result?.output === 'string') {
    try {
      pack = JSON.parse(outer.result.output);
    } catch {
      pack = undefined;
    }
  }
  const data = pack?.data ?? pack;
  if (!data || data.error || outer?.result?.ok === false) return { ok: false, elapsedMs };
  const report = data.decision_report ?? {};
  return { ok: true, status: data.status, confidence: data.confidence, title: report.title, conclusion: report.conclusion, analysis: report.analysis, elapsedMs };
}

export async function executeSkill(uniqueName: string, parameters: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<SkillResult> {
  const started = Date.now();
  const res = await fetch(env.CMC_MCP_URL, {
    method: 'POST',
    headers: { 'X-CMC-MCP-API-KEY': env.CMC_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_skill', arguments: { unique_name: uniqueName, parameters } } }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`cmc mcp ${res.status}: ${body.slice(0, 200)}`);
  const out = parseSkillPayload(parseRpcBody(body));
  // 20 credits / 次是实测值，端点本身不回 credit_count；计入 /stats 的用量
  creditMeter.add(20);
  log.info('skill run', { skill: uniqueName, ok: out.ok, status: out.status, elapsed: Date.now() - started });
  return out;
}
