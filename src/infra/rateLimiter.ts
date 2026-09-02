interface Window {
  count: number;
  resetAt: number;
}

/** 固定窗口计数器 + 独立冷却时间，够用且零依赖。 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly windowMs = 60_000) {}

  /** @returns 0 表示放行；>0 表示还需等待的毫秒数。 */
  check(key: string, limitPerWindow: number, cooldownMs = 0): number {
    const now = Date.now();

    const cooldownUntil = this.cooldowns.get(key) ?? 0;
    if (cooldownUntil > now) return cooldownUntil - now;

    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
    } else if (w.count >= limitPerWindow) {
      return w.resetAt - now;
    } else {
      w.count += 1;
    }

    if (cooldownMs > 0) this.cooldowns.set(key, now + cooldownMs);
    return 0;
  }

  reset(key: string): void {
    this.windows.delete(key);
    this.cooldowns.delete(key);
  }

  /** 定期调用以回收长期不活跃的 key。 */
  sweep(): void {
    const now = Date.now();
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    for (const [k, t] of this.cooldowns) if (t <= now) this.cooldowns.delete(k);
  }
}
