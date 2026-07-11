import { getTranslationAssetStorageKey } from "./word-assets.ts";
import type { WordAsset, WordAssetMap } from "./types.ts";

export interface WordAssetServiceHost {
  settings: { wordAssets?: WordAssetMap };
  persistWordAssetSidecar(reason?: string): Promise<void>;
  onWordAssetsChanged?(): void;
}

export class WordAssetService {
  private readonly host: WordAssetServiceHost;

  constructor(host: WordAssetServiceHost) {
    this.host = host;
  }

  get(key: string): WordAsset | null {
    return this.assets()[key] || null;
  }

  list(): WordAsset[] {
    return Object.values(this.assets());
  }

  async save(asset: WordAsset, reason = "save"): Promise<WordAsset> {
    const key = getTranslationAssetStorageKey(asset) || asset.lemma;
    if (!key) throw new Error("词条缺少可保存的标识。");
    await this.commit({ ...this.assets(), [key]: asset }, reason);
    return asset;
  }

  async update(key: string, transform: (asset: WordAsset) => WordAsset, reason = "save"): Promise<WordAsset | null> {
    const current = this.get(key);
    if (!current) return null;
    const updated = transform(current);
    return this.save(updated, reason);
  }

  async setMastered(key: string, mastered: boolean): Promise<WordAsset | null> {
    return this.update(key, (asset) => ({ ...asset, mastered, updated: new Date().toISOString() }));
  }

  async setMasteredMany(keys: Iterable<string>, mastered: boolean): Promise<number> {
    const next = { ...this.assets() };
    let count = 0;
    for (const key of keys) {
      const asset = next[key];
      if (asset) {
        next[key] = { ...asset, mastered, updated: new Date().toISOString() };
        count += 1;
      }
    }
    if (count) await this.commit(next, "save");
    return count;
  }

  async delete(key: string): Promise<boolean> {
    if (!this.get(key)) return false;
    const next = { ...this.assets() };
    delete next[key];
    await this.commit(next, "delete");
    return true;
  }

  async deleteMany(keys: Iterable<string>): Promise<number> {
    const next = { ...this.assets() };
    let count = 0;
    for (const key of keys) {
      if (next[key]) {
        delete next[key];
        count += 1;
      }
    }
    if (count) await this.commit(next, "delete");
    return count;
  }

  async replaceAll(assets: WordAssetMap, reason = "save"): Promise<void> {
    await this.commit({ ...assets }, reason);
  }

  private assets(): WordAssetMap {
    if (!this.host.settings.wordAssets || typeof this.host.settings.wordAssets !== "object") {
      this.host.settings.wordAssets = {};
    }
    return this.host.settings.wordAssets;
  }

  private async commit(next: WordAssetMap, reason: string): Promise<void> {
    const previous = this.assets();
    this.host.settings.wordAssets = next;
    try {
      await this.host.persistWordAssetSidecar(reason);
    } catch (error) {
      this.host.settings.wordAssets = previous;
      throw error;
    }
    this.host.onWordAssetsChanged?.();
  }
}
