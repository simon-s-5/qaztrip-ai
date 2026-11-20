import "server-only";

/** Small in-memory LRU-ish cache with in-flight de-duplication. */
export class MemoryCache<T> {
  private map = new Map<string, T>();
  private inflight = new Map<string, Promise<T>>();
  constructor(private max = 200) {}

  get(key: string): T | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  async getOrCreate(key: string, create: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = create()
      .then((v) => {
        this.map.set(key, v);
        if (this.map.size > this.max) {
          const oldest = this.map.keys().next().value;
          if (oldest !== undefined) this.map.delete(oldest);
        }
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
