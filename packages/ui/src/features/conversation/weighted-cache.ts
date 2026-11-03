/**
 * A cache that drops its oldest entries when it holds too many, or when the entries together weigh
 * too much. The count alone is not enough: 200 long messages keep far more memory than 200 short ones.
 * An entry that weighs more than the whole budget is not kept.
 */
export interface WeightedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, weight: number): void;
  readonly size: number;
  readonly weight: number;
}

export function createWeightedCache<V>(maxEntries: number, maxWeight: number): WeightedCache<V> {
  const entries = new Map<string, { value: V; weight: number }>();
  let total = 0;

  function dropOldest(): void {
    const oldest = entries.entries().next();
    if (oldest.done) return;
    entries.delete(oldest.value[0]);
    total -= oldest.value[1].weight;
  }

  return {
    get: (key) => entries.get(key)?.value,
    set(key, value, weight) {
      if (weight > maxWeight) return;
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        total -= existing.weight;
      }
      while (entries.size > 0 && (entries.size >= maxEntries || total + weight > maxWeight)) dropOldest();
      entries.set(key, { value, weight });
      total += weight;
    },
    get size() {
      return entries.size;
    },
    get weight() {
      return total;
    },
  };
}
