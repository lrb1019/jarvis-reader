import { Notice } from "obsidian";

/**
 * 自动解决 OneDrive / iCloud 等网盘由于同步延迟产生的冲突文件副本。
 */
export async function resolveSyncConflicts(plugin: any): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  if (!adapter || typeof adapter.list !== "function" || typeof adapter.read !== "function") {
    return;
  }

  let conflictsFound = 0;

  try {
    // 1. Resolve index sidecars (word-assets, highlights)
    const indexFolder = ".obsidian/plugins/jarvis-reader/index";
    if (await adapter.exists(indexFolder)) {
      const indexFiles = await adapter.list(indexFolder);
      
      const wordAssetConflicts = plugin.wordAssetSidecarUnavailable ? [] : indexFiles.files.filter((f: string) =>
        f.match(/word-assets[- (].*\.json$/) && !f.endsWith("word-assets.json")
      );
      
      const highlightConflicts = indexFiles.files.filter((f: string) => 
        f.match(/highlights[- (].*\.json$/) && !f.endsWith("highlights.json")
      );

      for (const file of wordAssetConflicts) {
        await mergeWordAssetConflict(plugin, file);
        conflictsFound++;
      }
      for (const file of highlightConflicts) {
        await mergeHighlightConflict(plugin, file);
        conflictsFound++;
      }
    }

    // 2. Resolve data.json conflicts
    const rootFolder = ".obsidian/plugins/jarvis-reader";
    if (await adapter.exists(rootFolder)) {
      const rootFiles = await adapter.list(rootFolder);
      const dataConflicts = rootFiles.files.filter((f: string) => 
        f.match(/data[- (].*\.json$/) && !f.endsWith("data.json")
      );

      for (const file of dataConflicts) {
        await mergeDataConflict(plugin, file);
        conflictsFound++;
      }
    }

    if (conflictsFound > 0) {
      // 触发保存和写入
      await plugin.saveSettings();
      if (typeof plugin.persistIndexSidecars === "function") {
        await plugin.persistIndexSidecars("auto-conflict-resolve");
      }
      new Notice(`Jarvis Reader 自动合并了 ${conflictsFound} 个网盘数据冲突文件。`);
    }

  } catch (err) {
    console.warn("Jarvis Reader auto conflict resolution failed", err);
  }
}

async function mergeWordAssetConflict(plugin: any, conflictPath: string) {
  const adapter = plugin.app.vault.adapter;
  const raw = await adapter.read(conflictPath);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid word asset conflict file:", conflictPath);
    return;
  }
  
  const conflictAssets = parsed.wordAssets || {};
  const currentAssets = plugin.settings.wordAssets || {};

  for (const [key, asset2] of Object.entries(conflictAssets)) {
    const asset2Typed = asset2 as any;
    if (!currentAssets[key]) {
      currentAssets[key] = asset2;
    } else {
      const asset1 = currentAssets[key];
      const mergedSources = [...(asset1.sources || [])];
      for (const src2 of (asset2Typed.sources || [])) {
        const exists = mergedSources.find(s => s.bookPath === src2.bookPath && s.cfiRange === src2.cfiRange);
        if (!exists) mergedSources.push(src2);
      }
      
      const d1 = new Date(asset1.updated || asset1.created).getTime();
      const d2 = new Date(asset2Typed.updated || asset2Typed.created).getTime();
      
      const reviewFields = ['nextReviewDate', 'interval', 'ease', 'reviews', 'reviewTimeMs', 'phonetic', 'partOfSpeech', 'example', 'tags', 'collins', 'oxford'];
      
      let useNewer = d2 > d1;
      
      if (useNewer) {
        asset1.translation = asset2Typed.translation;
        asset1.display = asset2Typed.display;
        asset1.mastered = asset2Typed.mastered;
        asset1.updated = asset2Typed.updated;
      }
      
      for (const field of reviewFields) {
        if (asset2Typed[field] !== undefined) {
          if (asset1[field] === undefined || useNewer) {
            asset1[field] = asset2Typed[field];
          }
        }
      }
      asset1.sources = mergedSources;
    }
  }
  
  plugin.settings.wordAssets = currentAssets;
  await adapter.trashSystem(conflictPath);
}

async function mergeHighlightConflict(plugin: any, conflictPath: string) {
  const adapter = plugin.app.vault.adapter;
  const raw = await adapter.read(conflictPath);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return;
  }

  const conflictHighlights = parsed.bookHighlights || {};
  plugin.settings.bookHighlights = plugin.settings.bookHighlights || {};
  const currentHighlights = plugin.settings.bookHighlights;

  for (const [bookPath, list2] of Object.entries(conflictHighlights)) {
    const list2Typed = list2 as any[];
    if (!currentHighlights[bookPath]) {
      currentHighlights[bookPath] = list2Typed;
    } else {
      const existingHl = currentHighlights[bookPath] as any[];
      for (const h2 of list2Typed) {
        const exists = existingHl.find(h1 => h1.id === h2.id || h1.cfiRange === h2.cfiRange);
        if (!exists) {
          existingHl.push(h2);
        } else {
          const d1 = new Date(exists.updated || exists.created).getTime();
          const d2 = new Date(h2.updated || h2.created).getTime();
          if (d2 > d1) {
            Object.assign(exists, h2);
          }
        }
      }
    }
  }
  await adapter.trashSystem(conflictPath);
}

async function mergeDataConflict(plugin: any, conflictPath: string) {
  const adapter = plugin.app.vault.adapter;
  const raw = await adapter.read(conflictPath);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return;
  }

  // merge readingStats
  if (parsed.readingStats) {
    plugin.settings.readingStats = plugin.settings.readingStats || {};
    for (const [dateKey, books] of Object.entries(parsed.readingStats)) {
      if (!plugin.settings.readingStats[dateKey]) {
        plugin.settings.readingStats[dateKey] = books;
      } else {
        for (const [bPath, bStats] of Object.entries(books as any)) {
          if (!plugin.settings.readingStats[dateKey][bPath]) {
            plugin.settings.readingStats[dateKey][bPath] = bStats;
          } else {
            plugin.settings.readingStats[dateKey][bPath] += (bStats as number);
          }
        }
      }
    }
  }

  // merge wordReviewStats
  if (parsed.wordReviewStats) {
    plugin.settings.wordReviewStats = plugin.settings.wordReviewStats || {};
    for (const [dateKey, stat] of Object.entries(parsed.wordReviewStats)) {
      if (!plugin.settings.wordReviewStats[dateKey]) {
        plugin.settings.wordReviewStats[dateKey] = stat;
      } else {
        const existing = plugin.settings.wordReviewStats[dateKey] as any;
        const incoming = stat as any;
        // Keep the max to avoid double counting if they just overlapped
        existing.reviewCount = Math.max(existing.reviewCount || 0, incoming.reviewCount || 0);
        existing.reviewTimeMs = Math.max(existing.reviewTimeMs || 0, incoming.reviewTimeMs || 0);
      }
    }
  }

  // merge bookProgress
  if (parsed.bookProgress) {
    plugin.settings.bookProgress = plugin.settings.bookProgress || {};
    for (const [bookPath, progress] of Object.entries(parsed.bookProgress)) {
      const incoming = progress as any;
      if (!plugin.settings.bookProgress[bookPath]) {
        plugin.settings.bookProgress[bookPath] = incoming;
      } else {
        const existing = plugin.settings.bookProgress[bookPath] as any;
        const d1 = new Date(existing.updated || 0).getTime();
        const d2 = new Date(incoming.updated || 0).getTime();
        if (d2 > d1) {
          plugin.settings.bookProgress[bookPath] = incoming;
        }
      }
    }
  }

  await adapter.trashSystem(conflictPath);
}
