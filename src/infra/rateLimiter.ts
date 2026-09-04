interface Window {
  count: number;
  resetAt: number;
}

export interface Reservation {
  /** 距离可以执行还要等多久；0 表示立即。 */
  delayMs: number;
}

/**
 * 固定窗口计数器 + 顺序排队的冷却时间，够用且零依赖。
 * 冷却不再是"丢弃"而是"排队"：每次放行占一个时间槽，下一个请求排到上一个槽之后 cooldownMs。
 * 窗口内槽位用完才丢弃，所以队列深度天然被 limitPerWindow 封顶。
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  /** 每个 key 最后一个已分配槽位的时刻。 */
  private readonly lastSlot = new Map<string, number>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * 申请一个执行槽。
   * @returns 拿到槽位时给出需要等待的毫秒数；窗口已满返回 undefined，并把 waitMs 放在异常字段里供提示。
   */
  reserve(key: string, limitPerWindow: number, cooldownMs = 0): Reservation | { delayMs?: undefined; retryAfterMs: number } {
    const now = this.now();

    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    if (w.count >= limitPerWindow) return { retryAfterMs: w.resetAt - now };
    w.count += 1;

    if (cooldownMs <= 0) return { delayMs: 0 };
    const slot = Math.max(now, (this.lastSlot.get(key) ?? 0) + cooldownMs);
    this.lastSlot.set(key, slot);
    return { delayMs: slot - now };
  }

  reset(key: string): void {
    this.windows.delete(key);
    this.lastSlot.delete(key);
  }

  /** 定期调用以回收长期不活跃的 key。 */
  sweep(): void {
    const now = this.now();
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    for (const [k, t] of this.lastSlot) if (t + this.windowMs <= now) this.lastSlot.delete(k);
  }
}
