interface SaveWaiter {
  version: number;
  resolve(): void;
  reject(error: unknown): void;
}

export class SettingsSaveQueue<T> {
  private readonly snapshot: () => T;
  private readonly write: (value: T) => Promise<void>;
  private readonly delayMs: number;
  private requestedVersion = 0;
  private processedVersion = 0;
  private waiters: SaveWaiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(snapshot: () => T, write: (value: T) => Promise<void>, delayMs = 40) {
    this.snapshot = snapshot;
    this.write = write;
    this.delayMs = delayMs;
  }

  request(): Promise<void> {
    const version = ++this.requestedVersion;
    const promise = new Promise<void>((resolve, reject) => {
      this.waiters.push({ version, resolve, reject });
    });
    this.schedule(this.delayMs);
    return promise;
  }

  flushNow(): Promise<void> {
    return this.requestWithDelay(0);
  }

  private requestWithDelay(delay: number): Promise<void> {
    const version = ++this.requestedVersion;
    const promise = new Promise<void>((resolve, reject) => {
      this.waiters.push({ version, resolve, reject });
    });
    this.schedule(delay);
    return promise;
  }

  private schedule(delay: number): void {
    if (this.running) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, delay);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.processedVersion < this.requestedVersion) {
        const targetVersion = this.requestedVersion;
        try {
          await this.write(this.snapshot());
          this.processedVersion = targetVersion;
          this.settleWaiters(targetVersion);
        } catch (error) {
          this.processedVersion = targetVersion;
          this.settleWaiters(targetVersion, error);
        }
      }
    } finally {
      this.running = false;
      if (this.processedVersion < this.requestedVersion) this.schedule(0);
    }
  }

  private settleWaiters(targetVersion: number, error?: unknown): void {
    const settled = this.waiters.filter((waiter) => waiter.version <= targetVersion);
    this.waiters = this.waiters.filter((waiter) => waiter.version > targetVersion);
    for (const waiter of settled) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }
}
