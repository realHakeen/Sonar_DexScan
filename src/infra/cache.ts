interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * 进程内 TTL 缓存 + 请求去重（in-flight dedupe）。
 * 群聊里同一个地址常被多人同时贴出，dedupe 能把 N 次上游调用压成 1 次。
 * 单机足够；多实例部署时把这个类换成 Redis 实现即可，调用方无需改动。
 */
export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.defaultTtlMs): void {
    if (this.store.size >= this.maxEntries) this.evict();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /** 命中缓存直接返回；否则合并并发请求，只放行一个 loader。 */
  async wrap(key: string, loader: () => Promise<V>, ttlMs = this.defaultTtlMs): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = loader()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, task);
    return task;
  }

  /** 简单清理：先删过期项，仍然超限则丢弃最早插入的 10%。 */
  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
    if (this.store.size < this.maxEntries) return;
    const drop = Math.ceil(this.maxEntries * 0.1);
    let i = 0;
    for (const k of this.store.keys()) {
      this.store.delete(k);
      if (++i >= drop) break;
    }
  }
}
