import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

export {
  normalizeVaultPath,
  joinVaultPath,
  formatLocalDate,
  formatLocalDateTime,
  sanitizeWordAssetFilename,
  escapeRegExp,
  escapeYamlString,
  normalizeHighlightQuote,
  normalizeWordDisplayText,
  ensureVaultFolder,
} from "./utils-core";

export function confirmDestructiveAction(app: App, title: string, message: string, confirmText = "确认删除"): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value: boolean) => {
      if (resolved)
        return;
      resolved = true;
      modal.close();
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(title);
    modal.contentEl.createEl("p", { text: message });
    new Setting(modal.contentEl)
      .addButton((button) => button
        .setButtonText("取消")
        .onClick(() => finish(false)))
      .addButton((button) => button
        .setButtonText(confirmText)
        .setWarning()
        .onClick(() => finish(true)));
    modal.onClose = () => finish(false);
    modal.open();
  });
}


export function formatDuration(secs: number): string {
  if (secs <= 0) return "0分钟";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}小时${m}分钟`;
  else if (h > 0) return `${h}小时`;
  else return `${m}分钟`;
}

export function getBookTotalSeconds(readingStats: Record<string, Record<string, number>> | undefined, bookPath: string): number {
  if (!readingStats) return 0;
  let sum = 0;
  for (const dateKey in readingStats) {
    if (readingStats[dateKey][bookPath]) sum += readingStats[dateKey][bookPath];
  }
  return sum;
}
