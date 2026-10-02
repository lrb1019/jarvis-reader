import { buildHighlightMetadata } from "./highlight-core.ts";
import type { JarvisReaderSettings } from "./types.ts";

export type BookPathState = Pick<JarvisReaderSettings, "bookInitLocations" | "bookProgress" | "bookBookmarks" | "bookHighlights" | "readingStats" | "wordAssets" | "bookCoverCache" | "bookPathAliases" | "bookNotePaths">;
const fields = ["bookInitLocations", "bookProgress", "bookBookmarks", "bookHighlights", "readingStats", "wordAssets", "bookCoverCache", "bookPathAliases", "bookNotePaths"] as const;
type Field = typeof fields[number];
interface Value { present: boolean; value?: unknown }
interface Patch { field: Field; key: string; before: Value; after: Value }
interface PendingRename { kind?: "note"; version: 1; oldPath: string; newPath: string; patches: Patch[] }
export interface BookPathHost {
  state(): BookPathState;
  persist(): Promise<void>;
  readPending(): Promise<string | null>;
  writePending(content: string): Promise<void>;
  clearPending(): Promise<void>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("书籍路径记录结构异常，已停止同步");
  return value as Record<string, unknown>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v !== undefined).map(([k, v]) => [k, canonical(v)]));
  return value;
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function indexed(field: Field, input: Value): Value {
  if (field === "bookHighlights" && input.present && Array.isArray(input.value)) return { present: true, value: input.value.map(buildHighlightMetadata) };
  return input;
}
function value(map: Record<string, unknown>, key: string): Value {
  return Object.hasOwn(map, key) ? { present: true, value: map[key] } : { present: false };
}
function validPath(path: string, extension = ".epub"): boolean { return !!path && !path.startsWith("/") && !path.split("/").some(part => part === ".." || !part) && path.toLowerCase().endsWith(extension); }

export function resolveBookPath(path: string, aliases: Record<string, string> = {}): string {
  const seen = new Set<string>();
  while (aliases[path]) {
    if (seen.has(path)) throw new Error("书籍路径关联存在循环");
    seen.add(path); path = aliases[path]!;
  }
  return path;
}

export function planBookRename(state: BookPathState, oldPath: string, newPath: string, notePath?: string): PendingRename {
  if (!validPath(oldPath) || !validPath(newPath) || oldPath === newPath) throw new Error("书籍改名路径无效");
  const patches: Patch[] = [];
  const set = (field: Field, key: string, after: Value) => {
    const before = indexed(field, value(record(state[field] || {}), key));
    after = indexed(field, after);
    if (!equal(before, after)) patches.push({ field, key, before, after });
  };
  for (const field of ["bookInitLocations", "bookProgress", "bookBookmarks", "bookHighlights", "bookNotePaths"] as const) {
    const map = record(state[field] || {});
    if (Object.hasOwn(map, newPath)) throw new Error("目标书籍路径已有记录，未覆盖；请检查路径冲突");
    if (!Object.hasOwn(map, oldPath)) continue;
    let next = map[oldPath];
    if (field === "bookHighlights") {
      if (!Array.isArray(next)) throw new Error("高亮记录结构异常");
      next = next.map(item => ({ ...record(item), bookPath: newPath }));
    }
    set(field, oldPath, { present: false }); set(field, newPath, { present: true, value: next });
  }
  if (notePath && !state.bookNotePaths?.[oldPath]) set("bookNotePaths", newPath, { present: true, value: notePath });
  for (const [day, dailyValue] of Object.entries(state.readingStats || {})) {
    const daily = record(dailyValue);
    if (!Object.hasOwn(daily, oldPath)) continue;
    if (Object.hasOwn(daily, newPath)) throw new Error("目标路径已有阅读时长，未合并");
    const next = { ...daily, [newPath]: daily[oldPath] }; delete next[oldPath];
    set("readingStats", day, { present: true, value: next });
  }
  for (const [key, asset] of Object.entries(state.wordAssets || {})) {
    if (!Array.isArray(asset.sources)) throw new Error("词条来源结构异常");
    if (asset.sources.some(source => source.bookPath === oldPath)) set("wordAssets", key, { present: true, value: { ...asset, sources: asset.sources.map(source => source.bookPath === oldPath ? { ...source, bookPath: newPath } : source) } });
  }
  for (const [key, entry] of Object.entries(state.bookCoverCache || {})) {
    if (!key.startsWith(`${oldPath}|`)) continue;
    const nextKey = `${newPath}${key.slice(oldPath.length)}`;
    if (Object.hasOwn(state.bookCoverCache, nextKey)) throw new Error("目标路径已有封面记录");
    set("bookCoverCache", key, { present: false }); set("bookCoverCache", nextKey, { present: true, value: entry });
  }
  // Flatten earlier aliases and support renaming back to an earlier filename.
  const aliases = state.bookPathAliases || {};
  for (const key of Object.keys(aliases)) {
    if (key === newPath) set("bookPathAliases", key, { present: false });
    else if (resolveBookPath(key, aliases) === oldPath) set("bookPathAliases", key, { present: true, value: newPath });
  }
  set("bookPathAliases", oldPath, { present: true, value: newPath });
  return { version: 1, oldPath, newPath, patches };
}

function planBookNoteRename(state: BookPathState, oldPath: string, newPath: string): PendingRename {
  if (!validPath(oldPath, ".md") || !validPath(newPath, ".md") || oldPath === newPath) throw new Error("笔记改名路径无效");
  const patches: Patch[] = [];
  for (const [bookPath, path] of Object.entries(state.bookNotePaths || {})) {
    if (path === oldPath) patches.push({ field: "bookNotePaths", key: bookPath, before: { present: true, value: oldPath }, after: { present: true, value: newPath } });
  }
  for (const [bookPath, highlights] of Object.entries(state.bookHighlights || {})) {
    if (!Array.isArray(highlights)) throw new Error("高亮记录结构异常");
    if (!highlights.some(item => item.notePath === oldPath)) continue;
    patches.push({ field: "bookHighlights", key: bookPath,
      before: indexed("bookHighlights", { present: true, value: highlights }),
      after: indexed("bookHighlights", { present: true, value: highlights.map(item => item.notePath === oldPath ? { ...item, notePath: newPath } : item) })
    });
  }
  return { kind: "note", version: 1, oldPath, newPath, patches };
}

function apply(state: BookPathState, pending: PendingRename, forward: boolean): void {
  // Validate every patch before changing any field; never overwrite subsequent edits.
  for (const patch of pending.patches) {
    const current = indexed(patch.field, value(record(state[patch.field] || {}), patch.key));
    if (!equal(current, patch.before) && !equal(current, patch.after)) throw new Error("路径恢复记录与当前数据冲突，未覆盖现有内容");
  }
  for (const patch of pending.patches) {
    if (!state[patch.field]) Object.assign(state, { [patch.field]: {} });
    const map = record(state[patch.field]); const target = forward ? patch.after : patch.before;
    if (target.present) {
      if (pending.kind === "note" && patch.field === "bookHighlights" && Array.isArray(target.value)) {
        const current = Array.isArray(map[patch.key]) ? map[patch.key] as unknown[] : [];
        map[patch.key] = target.value.map(item => {
          const metadata = record(item);
          const cached = current.find(entry => record(entry).id === metadata.id);
          return { ...(cached ? record(cached) : {}), ...metadata };
        });
      } else map[patch.key] = target.value;
    } else delete map[patch.key];
  }
}
function parsePending(content: string): PendingRename {
  const parsed = record(JSON.parse(content));
  const extension = parsed.kind === "note" ? ".md" : ".epub";
  if ((parsed.kind !== undefined && parsed.kind !== "note") || parsed.version !== 1 || typeof parsed.oldPath !== "string" || typeof parsed.newPath !== "string" || !validPath(parsed.oldPath, extension) || !validPath(parsed.newPath, extension) || !Array.isArray(parsed.patches)) throw new Error("路径恢复记录无效，原记录保留");
  const unique = new Set<string>();
  for (const item of parsed.patches) {
    const patch = record(item);
    if (!fields.includes(patch.field as Field) || typeof patch.key !== "string" || ["__proto__", "constructor", "prototype"].includes(patch.key)) throw new Error("路径恢复字段无效");
    if (parsed.kind === "note" && !["bookNotePaths", "bookHighlights"].includes(patch.field as string)) throw new Error("笔记路径恢复字段无效");
    for (const side of [patch.before, patch.after]) {
      const val = record(side);
      if (typeof val.present !== "boolean" || (val.present && !Object.hasOwn(val, "value"))) throw new Error("路径恢复值无效");
    }
    const id = `${patch.field}:${patch.key}`; if (unique.has(id)) throw new Error("重复路径恢复字段"); unique.add(id);
  }
  return parsed as unknown as PendingRename;
}

export class BookPathService {
  private running = false;
  private readonly host: BookPathHost;
  constructor(host: BookPathHost) { this.host = host; }
  async rename(oldPath: string, newPath: string, notePath?: string): Promise<void> {
    await this.run(() => planBookRename(this.host.state(), oldPath, newPath, notePath));
  }
  async renameNote(oldPath: string, newPath: string): Promise<void> {
    await this.run(() => planBookNoteRename(this.host.state(), oldPath, newPath));
  }
  private async run(plan: () => PendingRename): Promise<void> {
    if (this.running) throw new Error("存在未完成的书籍路径同步，请先恢复");
    this.running = true;
    try {
      if (await this.host.readPending()) throw new Error("存在未完成的书籍路径同步，请先恢复");
      const pending = plan();
      if (!pending.patches.length) return;
      const content = JSON.stringify(pending);
      await this.host.writePending(content);
      if (await this.host.readPending() !== content) throw new Error("路径恢复记录写入校验失败");
      await this.commit(pending);
    } finally { this.running = false; }
  }
  async recover(): Promise<boolean> {
    const content = await this.host.readPending(); if (!content) return false;
    const pending = parsePending(content);
    await this.commit(pending); return true;
  }
  private async commit(pending: PendingRename): Promise<void> {
    apply(this.host.state(), pending, true);
    try { await this.host.persist(); }
    catch (error) {
      apply(this.host.state(), pending, false);
      try { await this.host.persist(); } catch (rollbackError) { throw new AggregateError([error, rollbackError], "路径同步与回滚保存失败，恢复记录已保留"); }
      throw error;
    }
    await this.host.clearPending();
  }
}
