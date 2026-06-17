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
