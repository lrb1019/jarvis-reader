export type ReadingStatsState = Record<string, Record<string, number>>;

export class ReadingStatsService {
  private readonly pendingByBook = new Map<string, number>();
  private readonly inFlightByBook = new Map<string, Promise<number>>();

  add(bookPath: string, seconds = 1): void {
    if (!bookPath || !Number.isFinite(seconds) || seconds <= 0) return;
    this.pendingByBook.set(bookPath, (this.pendingByBook.get(bookPath) || 0) + seconds);
  }

  pending(bookPath: string): number {
    return this.pendingByBook.get(bookPath) || 0;
  }

  flush(bookPath: string, date: string, stats: ReadingStatsState, save: () => Promise<void>): Promise<number> {
    const existing = this.inFlightByBook.get(bookPath);
    if (existing) return existing;
    const task = this.persist(bookPath, date, stats, save).finally(() => {
      this.inFlightByBook.delete(bookPath);
    });
    this.inFlightByBook.set(bookPath, task);
    return task;
  }

  private async persist(bookPath: string, date: string, stats: ReadingStatsState, save: () => Promise<void>): Promise<number> {
    const seconds = this.pending(bookPath);
    if (seconds <= 0) return 0;
    const daily = stats[date] || (stats[date] = {});
    const previous = daily[bookPath] || 0;
    daily[bookPath] = previous + seconds;
    try {
      await save();
    } catch (error) {
      if (previous > 0) daily[bookPath] = previous;
      else delete daily[bookPath];
      if (Object.keys(daily).length === 0) delete stats[date];
      throw error;
    }
    this.pendingByBook.set(bookPath, Math.max(0, this.pending(bookPath) - seconds));
    return seconds;
  }
}
