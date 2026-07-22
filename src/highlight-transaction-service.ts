import { buildHighlightMetadata } from "./highlight-core.ts";
import type { BookHighlight, PersistedBookHighlight } from "./types.ts";

export interface HighlightTransactionAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface HighlightTransactionHost {
  adapter: HighlightTransactionAdapter;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  getBookHighlights(bookPath: string): BookHighlight[];
  replaceBookHighlights(bookPath: string, highlights: BookHighlight[], reason: string): Promise<void>;
}

export interface HighlightTransactionRequest {
  bookPath: string;
  notePath: string;
  reason: string;
  previousHighlights: BookHighlight[];
  nextHighlights: BookHighlight[];
  applyMarkdown(): Promise<void>;
}

interface PendingHighlightTransaction {
  version: 1;
  id: string;
  bookPath: string;
  notePath: string;
  reason: string;
  previousHighlights: PersistedBookHighlight[];
  nextHighlights: PersistedBookHighlight[];
  previousMarkdown: string;
  created: string;
}

export interface HighlightRecoveryResult {
  finalized: number;
  rolledBack: number;
  errors: string[];
}

const PENDING_FOLDER = ".obsidian/plugins/jarvis-reader/pending/highlights";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHighlights(highlights: BookHighlight[]): PersistedBookHighlight[] {
  return highlights.map((highlight) => buildHighlightMetadata(highlight) as PersistedBookHighlight);
}

function sameHighlights(left: BookHighlight[] | PersistedBookHighlight[], right: PersistedBookHighlight[]): boolean {
  return JSON.stringify(normalizeHighlights(left as BookHighlight[])) === JSON.stringify(right);
}

function parsePending(payload: unknown): PendingHighlightTransaction | null {
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (typeof payload.id !== "string" || typeof payload.bookPath !== "string" || typeof payload.notePath !== "string") return null;
  if (typeof payload.reason !== "string" || typeof payload.previousMarkdown !== "string" || typeof payload.created !== "string") return null;
  if (!Array.isArray(payload.previousHighlights) || !Array.isArray(payload.nextHighlights)) return null;
  return payload as unknown as PendingHighlightTransaction;
}

async function ensureFolder(adapter: HighlightTransactionAdapter): Promise<void> {
  let current = "";
  for (const part of PENDING_FOLDER.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) await adapter.mkdir(current);
  }
}

function createTransactionId(): string {
  return `highlight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class HighlightTransactionService {
  private readonly host: HighlightTransactionHost;

  constructor(host: HighlightTransactionHost) {
    this.host = host;
  }

  async execute(request: HighlightTransactionRequest): Promise<void> {
    const previousMarkdown = await this.host.readNote(request.notePath);
    const pending: PendingHighlightTransaction = {
      version: 1,
      id: createTransactionId(),
      bookPath: request.bookPath,
      notePath: request.notePath,
      reason: request.reason,
      previousHighlights: normalizeHighlights(request.previousHighlights),
      nextHighlights: normalizeHighlights(request.nextHighlights),
      previousMarkdown,
      created: new Date().toISOString(),
    };
    await ensureFolder(this.host.adapter);
    const pendingPath = `${PENDING_FOLDER}/${pending.id}.json`;
    await this.host.adapter.write(pendingPath, JSON.stringify(pending));

    try {
      await request.applyMarkdown();
    } catch (error) {
      await this.rollbackMarkdown(pending, pendingPath, error);
      throw error;
    }

    try {
      await this.host.replaceBookHighlights(request.bookPath, request.nextHighlights, request.reason);
    } catch (error) {
      await this.rollbackMarkdown(pending, pendingPath, error);
      throw error;
    }

    try {
      await this.host.adapter.remove(pendingPath);
    } catch {
      // The committed operation is safe. Startup recovery will recognize nextHighlights and remove the stale marker.
    }
  }

  async recoverPending(): Promise<HighlightRecoveryResult> {
    const result: HighlightRecoveryResult = { finalized: 0, rolledBack: 0, errors: [] };
    if (!await this.host.adapter.exists(PENDING_FOLDER)) return result;
    const listing = await this.host.adapter.list(PENDING_FOLDER);
    for (const path of listing.files.filter((file) => file.endsWith(".json"))) {
      try {
        const pending = parsePending(JSON.parse(await this.host.adapter.read(path)));
        if (!pending) throw new Error("事务记录结构非法");
        const current = this.host.getBookHighlights(pending.bookPath);
        if (sameHighlights(current, pending.nextHighlights)) {
          await this.host.adapter.remove(path);
          result.finalized += 1;
          continue;
        }
        if (!sameHighlights(current, pending.previousHighlights)) {
          throw new Error("当前高亮索引既不匹配事务前状态，也不匹配事务后状态");
        }
        await this.host.writeNote(pending.notePath, pending.previousMarkdown);
        await this.host.replaceBookHighlights(pending.bookPath, pending.previousHighlights as BookHighlight[], "recover-highlight-rollback");
        await this.host.adapter.remove(path);
        result.rolledBack += 1;
      } catch (error) {
        result.errors.push(`${path}: ${error instanceof Error ? error.message : "未知错误"}`);
      }
    }
    return result;
  }

  private async rollbackMarkdown(pending: PendingHighlightTransaction, pendingPath: string, cause: unknown): Promise<void> {
    try {
      await this.host.writeNote(pending.notePath, pending.previousMarkdown);
      await this.host.adapter.remove(pendingPath);
    } catch (rollbackError) {
      throw new Error(
        `高亮操作失败且 Markdown 自动回滚未完成，恢复记录已保留。原始错误：${cause instanceof Error ? cause.message : "未知错误"}；回滚错误：${rollbackError instanceof Error ? rollbackError.message : "未知错误"}`,
      );
    }
  }
}
