import { Modal, Notice, Setting, type App } from "obsidian";
import { hasConflictFiles, type ConflictFileSet } from "./conflict-resolution-core.ts";
import {
  allConflictPaths,
  detectSyncConflicts,
  mergeConfirmedConflicts,
  type ConflictResolutionHost,
} from "./conflict-resolution-service.ts";

type ConflictPlugin = ConflictResolutionHost & { app: App & ConflictResolutionHost["app"] };

function confirmConflictResolution(app: App, files: ConflictFileSet): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };

    modal.titleEl.setText("发现同步冲突副本");
    modal.contentEl.createEl("p", {
      text: "Jarvis Reader 只检测到了冲突文件，尚未修改任何数据。确认后会先备份当前主文件和全部冲突副本，再合并数据；合并成功后冲突副本会移入系统废纸篓。",
    });
    const list = modal.contentEl.createEl("ul");
    for (const path of allConflictPaths(files)) list.createEl("li", { text: path });
    modal.contentEl.createEl("p", {
      text: `共 ${allConflictPaths(files).length} 个文件。选择“稍后处理”将保持所有文件原样。`,
    });
    new Setting(modal.contentEl)
      .addButton((button) => button.setButtonText("稍后处理").onClick(() => finish(false)))
      .addButton((button) => button.setButtonText("备份并合并").setWarning().onClick(() => finish(true)));
    modal.onClose = () => finish(false);
    modal.open();
  });
}

export async function resolveSyncConflicts(plugin: ConflictPlugin): Promise<void> {
  try {
    const files = await detectSyncConflicts(plugin.app.vault.adapter, plugin);
    if (!hasConflictFiles(files)) return;
    const confirmed = await confirmConflictResolution(plugin.app, files);
    if (!confirmed) {
      new Notice("同步冲突副本保持原样，可在下次启动时继续处理。");
      return;
    }
    const backupRoot = await mergeConfirmedConflicts(plugin, files);
    new Notice(`同步冲突已备份并合并。备份位置：${backupRoot}`, 10000);
  } catch (error) {
    console.error("Jarvis Reader conflict resolution failed.", error);
    new Notice(`同步冲突处理失败，冲突副本未删除：${error instanceof Error ? error.message : "未知错误"}`, 0);
  }
}
