export class ActiveConnectionCounter {
  private readonly limit: number;
  private readonly counts = new Map<string, number>();

  constructor(limit: number) {
    this.limit = limit;
  }

  acquire(key: string) {
    const activeCount = this.counts.get(key) ?? 0;
    if (activeCount >= this.limit) {
      return null;
    }

    this.counts.set(key, activeCount + 1);
    return new ActiveConnectionLease(this, key);
  }

  getActiveCount(key: string) {
    return this.counts.get(key) ?? 0;
  }

  release(key: string) {
    const remainingCount = (this.counts.get(key) ?? 1) - 1;

    if (remainingCount > 0) {
      this.counts.set(key, remainingCount);
      return;
    }

    this.counts.delete(key);
  }
}

export class ActiveConnectionLease {
  private released = false;
  private readonly counter: ActiveConnectionCounter;
  private readonly key: string;

  constructor(counter: ActiveConnectionCounter, key: string) {
    this.counter = counter;
    this.key = key;
  }

  release() {
    if (this.released) {
      return false;
    }

    this.released = true;
    this.counter.release(this.key);
    return true;
  }
}
