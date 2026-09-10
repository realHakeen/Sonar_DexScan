import { env } from '../config/env.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('gemini');
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GenerateResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** 文本生成器接口：/lore 只依赖这个，测试里用假的。 */
export type TextGenerator = (system: string, user: string) => Promise<GenerateResult>;

/**
 * Gemini generateContent 的最小封装（AI Studio 免费档，2026-09-10 实测 gemini-3.5-flash-lite 每次 1–4s）。
 * 不用 SDK：只有一个端点，fetch 足够；失败抛错由调用方降级。
 */
export function geminiGenerator(opts: { apiKey?: string; model?: string; timeoutMs?: number } = {}): TextGenerator | undefined {
  const apiKey = opts.apiKey ?? env.LORE_API_KEY;
  const model = opts.model ?? env.LORE_MODEL;
  if (!apiKey) return undefined;
  return async (system, user) => {
    const started = Date.now();
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: number; message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!res.ok || body.error) throw new Error(`gemini ${res.status}: ${body.error?.message ?? 'request failed'}`);
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    if (!text) throw new Error('gemini: empty response');
    log.debug('generated', { model, elapsed: Date.now() - started, in: body.usageMetadata?.promptTokenCount, out: body.usageMetadata?.candidatesTokenCount });
    return { text, inputTokens: body.usageMetadata?.promptTokenCount, outputTokens: body.usageMetadata?.candidatesTokenCount };
  };
}
