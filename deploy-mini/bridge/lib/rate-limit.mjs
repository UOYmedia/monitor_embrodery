/**
 * Fixed-window rate limiter keyed by caller + bucket name.
 * Guards the two endpoints an operator could accidentally weaponise against workshop
 * Wi-Fi: subnet scanning and bulk pairing.
 */
export class RateLimiter {
  constructor({ windowMs = 60_000, now = () => Date.now() } = {}) {
    this.windowMs = windowMs
    this.now = now
    this.buckets = new Map()
  }

  /** Returns `{ allowed, remaining, retryAfterMs }` and consumes a slot when allowed. */
  take(key, limit) {
    // `bucket.count >= undefined` và `>= NaN` đều là false, tức bộ chặn TẮT HOÀN TOÀN và
    // `remaining` thành NaN. Sai kiểu "im lặng mở toang" nguy hơn hẳn sai kiểu "chặn nhầm":
    // một chỗ gọi quên truyền ngưỡng là bridge mất hàng rào mà không kêu tiếng nào.
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError(`Ngưỡng chặn tần suất phải là số nguyên >= 1, nhận được ${String(limit)}.`)
    }
    const at = this.now()
    const bucket = this.buckets.get(key)
    if (!bucket || at >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: at + this.windowMs })
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 }
    }
    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - at }
    }
    bucket.count += 1
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 }
  }

  /** Drops expired buckets so a long-running bridge does not grow a map per client. */
  prune() {
    const at = this.now()
    for (const [key, bucket] of this.buckets) if (at >= bucket.resetAt) this.buckets.delete(key)
  }
}
