import { App, Platform, TFile } from "obsidian";
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
  getView(): ClaudianView | null;
}

interface ClaudianInputElement extends HTMLElement {
  value: string;
}

interface ClaudianView {
  getActiveTab(): {
    dom: { inputEl: ClaudianInputElement };
  } | null;
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

/** Claudian's view and input element are private APIs; keep their use in this adapter. */
export async function triggerClaudianPrompt(app: App, prompt: string): Promise<void> {
  const appWithPlugins = app as unknown as ObsidianAppWithPlugins;
  const claudianPlugin = appWithPlugins.plugins?.getPlugin(
    "realclaudian"
  ) as ClaudianPlugin | null;

  if (!claudianPlugin) {
    throw new Error("未检测到 Claudian 插件，请先安装并启用该插件。");
  }

  if (typeof claudianPlugin.activateView !== "function" || typeof claudianPlugin.getView !== "function") {
    throw new Error("Claudian 界面接口已变化，无法打开对话窗口。");
  }

  await claudianPlugin.activateView();
  const input = claudianPlugin.getView()?.getActiveTab()?.dom.inputEl;
  if (!input || !input.isConnected || typeof input.value !== "string") {
    throw new Error("Claudian 对话输入框尚未就绪，请打开对话后重试。");
  }
  if (input.value.trim()) {
    throw new Error("Claudian 输入框中有未发送的内容，请先处理后重试。");
  }

  const inputWindow = input.ownerDocument.defaultView;
  if (!inputWindow) {
    throw new Error("Claudian 对话窗口不可用，请重新打开后重试。");
  }

  input.value = prompt;
  input.dispatchEvent(new inputWindow.Event("input", { bubbles: true }));
  input.focus();

  // Claudian accepts Command+Enter / Ctrl+Enter even when its Enter setting changes.
  const enterEvent = new inputWindow.KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    metaKey: Platform.isMacOS,
    ctrlKey: !Platform.isMacOS,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(enterEvent);
  if (!enterEvent.defaultPrevented) {
    throw new Error("Claudian 未接收发送操作，内容已留在输入框中，请检查后手动发送。");
  }
}
