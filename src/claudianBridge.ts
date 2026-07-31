import { App, Notice, TFile } from "obsidian";
import {
  buildPromptFromTemplate,
  prepareSmartCommandPrompt,
} from "./smart-command-core";
import type {
  SmartCommand,
  SmartCommandVariables,
} from "./smart-command-core";

export {
  buildPromptFromTemplate,
  prepareSmartCommandPrompt,
};
export type {
  SmartCommand,
  SmartCommandVariables,
} from "./smart-command-core";

interface ClaudianPlugin {
  activateView(): Promise<void>;
}

interface ObsidianAppWithPlugins extends App {
  plugins?: {
    getPlugin(id: string): unknown;
  };
}

export async function prepareSmartCommandPromptFromVault(
  app: App,
  command: SmartCommand,
  vars: SmartCommandVariables
): Promise<string> {
  return prepareSmartCommandPrompt(command, vars, async (path) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    return app.vault.read(file);
  });
}

/**
 * Send a prompt to the Claudian plugin's input textarea and auto-submit.
 * Mirrors the Vault OS triggerClaudianPrompt implementation.
 */
export function triggerClaudianPrompt(app: App, prompt: string): void {
  const appWithPlugins = app as unknown as ObsidianAppWithPlugins;
  const claudianPlugin = appWithPlugins.plugins?.getPlugin(
    "realclaudian"
  ) as ClaudianPlugin | null;

  if (!claudianPlugin) {
    new Notice("未检测到 Claudian 插件，请先安装并启用该插件。");
    return;
  }

  if (typeof claudianPlugin.activateView === "function") {
    void claudianPlugin.activateView();
  }

  window.setTimeout(() => {
    const textarea = activeDocument.querySelector<HTMLTextAreaElement>(
      ".claudian-input-wrapper textarea.claudian-input"
    );
    if (!textarea) {
      new Notice("无法定位 Claudian 输入框，请确保其窗口已打开。");
      return;
    }

    textarea.value = prompt;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(enterEvent);
  }, 300);
}
