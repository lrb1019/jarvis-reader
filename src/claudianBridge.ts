import { App, Notice } from "obsidian";

export interface SmartCommand {
  id: string;
  label: string;
  description?: string;
  icon: string;
  prompt: string;
  enabled: boolean;
  scope: "selection" | "note" | "both";
}

interface ClaudianPlugin {
  activateView(): Promise<void>;
}

interface ObsidianAppWithPlugins extends App {
  plugins?: {
    getPlugin(id: string): unknown;
  };
}

/**
 * Replace template variables in a prompt string.
 * Supported: {{selection}}, {{content}}, {{book_title}}, {{chapter}}
 */
export function buildPromptFromTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
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
