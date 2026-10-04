export type ReadingStatsState = Record<string, Record<string, number>>;

const savesByState = new WeakMap<ReadingStatsState, Promise<unknown>>();

function serializeSave<T>(stats: ReadingStatsState, action: () => Promise<T>): Promise<T> {
  const previous = savesByState.get(stats) || Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  savesByState.set(stats, task);
  return task;
}

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
    const seconds = this.pending(bookPath);
    const task = serializeSave(stats, () => this.persist(bookPath, date, stats, save, seconds)).finally(() => {
      this.inFlightByBook.delete(bookPath);
    });
    this.inFlightByBook.set(bookPath, task);
    return task;
  }

  async flushAndProject(
    bookPath: string,
    date: string,
    stats: ReadingStatsState,
    save: () => Promise<void>,
    project: (totalSeconds: number) => Promise<void>,
    reportProjectionError: (error: unknown) => void,
  ): Promise<void> {
    if (this.pending(bookPath) <= 0) return;
    await this.flush(bookPath, date, stats, save);
    let totalSeconds = 0;
    Object.values(stats).forEach((daily) => {
      if (daily[bookPath]) totalSeconds += daily[bookPath];
    });
    try {
      await project(totalSeconds);
    } catch (error) {
      reportProjectionError(error);
    }
  }

  recordManual(bookPath: string, date: string, minutes: number, stats: ReadingStatsState, save: () => Promise<void>): Promise<void> {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!bookPath || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
      return Promise.reject(new Error("请输入有效日期和 1～1440 分钟的阅读时长"));
    }
    return serializeSave(stats, async () => {
      const existing = stats[date];
      if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
        throw new Error("阅读统计数据异常，未写入补录记录");
      }
      const value = existing?.[bookPath];
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error("阅读统计数据异常，未写入补录记录");
      }
      const daily = stats[date] || (stats[date] = {});
      const previous = daily[bookPath];
      daily[bookPath] = (previous || 0) + minutes * 60;
      try {
        await save();
      } catch (error) {
        if (previous === undefined) delete daily[bookPath];
        else daily[bookPath] = previous;
        if (Object.keys(daily).length === 0) delete stats[date];
        throw error;
      }
    });
  }

  private async persist(bookPath: string, date: string, stats: ReadingStatsState, save: () => Promise<void>, seconds: number): Promise<number> {
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
