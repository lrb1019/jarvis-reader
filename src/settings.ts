import { PluginSettingTab, Setting, FuzzySuggestModal, TFolder, Notice, App } from "obsidian";
import { normalizeVaultPath } from "./utils";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE, TRANSLATION_PROMPT_HELP_TEXT } from "./word-assets";
import { normalizeTranslationProvider, getTranslationProviderDefaults, validateTranslationPromptJsonTemplate, translateSelectionWithApi } from "./translation";
import type JarvisReaderPlugin from "./main";

export const DEFAULT_SETTINGS = {
  scrolledView: false,
  singlePageView: false,
  readerZoom: 1,
  readerLineHeight: 1.6,
  bookNoteFolder: "",
  bookNoteTemplate: "",
  wordNoteFolder: "09 Books/Words",
  wordAssets: {},
  translationApi: {
    provider: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    model: ""
  },
  experimentalInstantTranslation: {
    enabled: false
  },
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  autoHighlightFolders: ["09 Books"],
  enableWordAudio: true,
  wordAudioTemplate: DEFAULT_WORD_AUDIO_TEMPLATE,
  wordAudioAccent: "us",
  blurWordCardBody: true,
  speechLang: "en-US",
  bookInitLocations: {},
  bookHighlights: {},
  bookProgress: {},
  bookCoverCache: {},
  sidebarLayoutMode: "single",
  sidebarPaneSplit: 48,
  bookshelfCoverOnly: false
};
export class JarvisReaderFolderSuggestModal extends FuzzySuggestModal<string> {
  onChoose: (path: string) => void;
  folders: string[];
  constructor(app: App, onChoose: (path: string) => void) {
    super(app);
    this.onChoose = onChoose;
    this.folders = app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder).map((folder) => folder.path).filter((path) => path && path !== "/").sort((a, b) => a.localeCompare(b));
    this.setPlaceholder("\u9009\u62e9\u6216\u8f93\u5165\u6587\u4ef6\u5939");
  }
  getItems() {
    return ["", ...this.folders];
  }
  getItemText(path) {
    return path || "\u9009\u62e9\u6587\u4ef6\u5939";
  }
  onChooseItem(path) {
    this.onChoose(path);
  }
};
export class JarvisReaderSettingTab extends PluginSettingTab {
  plugin: JarvisReaderPlugin;
  constructor(app: App, plugin: JarvisReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Jarvis Reader \u8bbe\u7f6e" });
    let translationBaseUrlText = null;
    let translationModelText = null;
    new Setting(containerEl).setName("\u6eda\u52a8\u9605\u8bfb").setDesc("\u4f7f\u7528\u8fde\u7eed\u6eda\u52a8\u9605\u8bfb\u6a21\u5f0f").addToggle((toggle) => toggle.setValue(this.plugin.settings.scrolledView).onChange(async (value) => {
      this.plugin.settings.scrolledView = value;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName("\u5355\u9875\u9605\u8bfb").setDesc("\u4f7f\u7528\u5355\u9875\u9605\u8bfb\u6a21\u5f0f").addToggle((toggle) => toggle.setValue(this.plugin.settings.singlePageView).onChange(async (value) => {
      this.plugin.settings.singlePageView = value;
      await this.plugin.saveSettings();
    }));
    let folderText = null;
    new Setting(containerEl).setName("\u8bfb\u4e66\u7b14\u8bb0\u6587\u4ef6\u5939").setDesc("\u4fdd\u5b58\u81ea\u52a8\u751f\u6210\u8bfb\u4e66\u7b14\u8bb0\u7684\u6587\u4ef6\u5939").addText((text) => {
      folderText = text;
      text.setPlaceholder("\u9009\u62e9\u6216\u8f93\u5165\u6587\u4ef6\u5939").setValue(this.plugin.settings.bookNoteFolder || "").onChange(async (value) => {
        this.plugin.settings.bookNoteFolder = normalizeVaultPath(value);
        await this.plugin.saveSettings();
      });
    }).addButton((button) => button.setButtonText("\u9009\u62e9").onClick(() => {
      new JarvisReaderFolderSuggestModal(this.app, async (path) => {
        this.plugin.settings.bookNoteFolder = path;
        await this.plugin.saveSettings();
        if (folderText) {
          folderText.setValue(path);
        }
      }).open();
    })).addButton((button) => button.setButtonText("\u6e05\u9664").onClick(async () => {
      this.plugin.settings.bookNoteFolder = "";
      await this.plugin.saveSettings();
      if (folderText) {
        folderText.setValue("");
      }
    }));
    new Setting(containerEl).setName("\u8bfb\u4e66\u7b14\u8bb0\u6a21\u677f").setDesc("\u652f\u6301 {{bookname}} {{title}} {{extension}} {{created}} {{toc}}").addTextArea((text) => {
      text.setPlaceholder(`---
bookname: "[[{{bookname}}]]"
created: {{created}}
---

{{toc}}`).setValue(this.plugin.settings.bookNoteTemplate || "").onChange(async (value) => {
        this.plugin.settings.bookNoteTemplate = value;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 8;
      text.inputEl.style.width = "100%";
    });
    new Setting(containerEl).setName("单词笔记文件夹").setDesc("保存全局单词卡片笔记的文件夹").addText((text) => {
      text.setPlaceholder("09 Books/Words").setValue(this.plugin.settings.wordNoteFolder || "").onChange(async (value) => {
        this.plugin.settings.wordNoteFolder = normalizeVaultPath(value);
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("同步词条到 Markdown").setDesc("从词条主数据单向重建或更新 Markdown，不从 Markdown 反向导入。").addButton((button) => button.setButtonText("同步词条").onClick(async () => {
      button.setDisabled(true);
      try {
        const result = await this.plugin.syncAllWordAssetsToMarkdown();
        new Notice(`词条同步完成：成功 ${result.synced} 条，失败 ${result.failed} 条。`);
      } catch (error) {
        console.error("Jarvis Reader word asset sync failed.", error);
        new Notice("词条同步失败，请查看开发者错误。");
      } finally {
        button.setDisabled(false);
      }
    }));
    new Setting(containerEl).setName("自动标记文件夹").setDesc("只在这些文件夹下的 EPUB 中自动标记已保存单词；多个文件夹用英文逗号分隔").addText((text) => {
      text.setPlaceholder("09 Books").setValue((this.plugin.settings.autoHighlightFolders || []).join(", ")).onChange(async (value) => {
        this.plugin.settings.autoHighlightFolders = value.split(",").map((item) => normalizeVaultPath(item)).filter(Boolean);
        await this.plugin.saveSettings();
      });
    });
    const experimental = this.plugin.settings.experimentalInstantTranslation || {};
    new Setting(containerEl).setName("实验：选中即翻译").setDesc("默认关闭。开启后选中文本会直接打开翻译弹窗，不再先显示操作菜单").addToggle((toggle) => toggle.setValue(experimental.enabled === true).onChange(async (value) => {
      this.plugin.settings.experimentalInstantTranslation.enabled = value;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName("内置离线词典").setDesc("固定使用 Jarvis Reader 自带的 ECDICT 词典；无需导入或配置路径。");
    new Setting(containerEl).setName("翻译服务").setDesc("选择 API 请求格式；自定义会继续按 URL 自动识别").addDropdown((dropdown) => {
      dropdown.addOption("openai-compatible", "OpenAI 兼容").addOption("anthropic", "Anthropic Claude").addOption("gemini", "Google Gemini").addOption("custom", "自定义").setValue((this.plugin.settings.translationApi || {}).provider || "openai-compatible").onChange(async (value) => {
        const provider = normalizeTranslationProvider(value, this.plugin.settings.translationApi.baseUrl);
        const defaults = getTranslationProviderDefaults(provider);
        this.plugin.settings.translationApi.provider = provider;
        if (!String(this.plugin.settings.translationApi.baseUrl || "").trim() && defaults.baseUrl) {
          this.plugin.settings.translationApi.baseUrl = defaults.baseUrl;
        }
        if (!String(this.plugin.settings.translationApi.model || "").trim() && defaults.model) {
          this.plugin.settings.translationApi.model = defaults.model;
        }
        await this.plugin.saveSettings();
        if (translationBaseUrlText) {
          translationBaseUrlText.setPlaceholder(defaults.baseUrl || "https://...");
          translationBaseUrlText.setValue(this.plugin.settings.translationApi.baseUrl || "");
        }
        if (translationModelText) {
          translationModelText.setPlaceholder(defaults.model || "模型 ID");
          translationModelText.setValue(this.plugin.settings.translationApi.model || "");
        }
      });
    });
    new Setting(containerEl).setName("翻译 API 基础地址").setDesc("服务商基础地址；插件会按所选服务自动追加请求路径").addText((text) => {
      translationBaseUrlText = text;
      const defaults = getTranslationProviderDefaults((this.plugin.settings.translationApi || {}).provider);
      text.setPlaceholder(defaults.baseUrl || "https://...").setValue((this.plugin.settings.translationApi || {}).baseUrl || "").onChange(async (value) => {
        this.plugin.settings.translationApi.baseUrl = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    });
    new Setting(containerEl).setName("翻译 API 密钥").setDesc("用于请求翻译服务的访问密钥").addText((text) => {
      text.setPlaceholder("sk-...").setValue((this.plugin.settings.translationApi || {}).apiKey || "").onChange(async (value) => {
        this.plugin.settings.translationApi.apiKey = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
      text.inputEl.style.width = "100%";
    });
    new Setting(containerEl).setName("翻译模型").setDesc("当前服务使用的模型 ID").addText((text) => {
      translationModelText = text;
      const defaults = getTranslationProviderDefaults((this.plugin.settings.translationApi || {}).provider);
      text.setPlaceholder(defaults.model || "模型 ID").setValue((this.plugin.settings.translationApi || {}).model || "").onChange(async (value) => {
        this.plugin.settings.translationApi.model = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    }).addButton((button) => button.setButtonText("测试").onClick(async () => {
      try {
        const promptCheck = validateTranslationPromptJsonTemplate(this.plugin.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT);
        if (!promptCheck.ok) {
          new Notice(`提示词 JSON 模板无效：${promptCheck.error}`);
          return;
        }
        await translateSelectionWithApi(this.plugin.settings, "test");
        new Notice("测试成功");
      } catch (error) {
        new Notice(`翻译测试失败：${error.message || error}`);
      }
    }));
    containerEl.createDiv({
      cls: "jarvis-reader-translation-prompt-help",
      text: TRANSLATION_PROMPT_HELP_TEXT
    });
    let translationPromptText = null;
    new Setting(containerEl).setName("翻译提示词").setDesc("用于生成单词释义的提示词").addTextArea((text) => {
      translationPromptText = text;
      text.setValue(this.plugin.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT).onChange(async (value) => {
        this.plugin.settings.translationPrompt = value || DEFAULT_TRANSLATION_PROMPT;
        await this.plugin.saveSettings();
      });
      text.inputEl.rows = 6;
      text.inputEl.style.width = "100%";
    });
    new Setting(containerEl).setName("").setDesc("").addButton((button) => button.setButtonText("\u6062\u590d\u9ed8\u8ba4\u63d0\u793a\u8bcd").onClick(async () => {
      this.plugin.settings.translationPrompt = DEFAULT_TRANSLATION_PROMPT;
      await this.plugin.saveSettings();
      if (translationPromptText) {
        translationPromptText.setValue(DEFAULT_TRANSLATION_PROMPT);
      }
      new Notice("已恢复默认翻译提示词。");
    }));
    new Setting(containerEl).setName("模糊单词卡正文").setDesc("只模糊可滚动的单词卡正文；鼠标悬停后显示，标题和来源始终可见").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.blurWordCardBody).onChange(async (value) => {
      this.plugin.settings.blurWordCardBody = value;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName("启用单词发音").setDesc("优先使用发音链接；失败时回退到浏览器语音合成").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.enableWordAudio).onChange(async (value) => {
      this.plugin.settings.enableWordAudio = value;
      await this.plugin.saveSettings();
    }));
    new Setting(containerEl).setName("发音链接模板").setDesc("可用 {{word}}、{{type}}、{{accent}}。有道 type：1 英式，2 美式。").addText((text) => {
      text.setPlaceholder(DEFAULT_WORD_AUDIO_TEMPLATE).setValue(this.plugin.settings.wordAudioTemplate || DEFAULT_WORD_AUDIO_TEMPLATE).onChange(async (value) => {
        this.plugin.settings.wordAudioTemplate = value.trim() || DEFAULT_WORD_AUDIO_TEMPLATE;
        await this.plugin.saveSettings();
      });
      text.inputEl.style.width = "100%";
    });
    new Setting(containerEl).setName("发音口音").setDesc("选择美式或英式发音").addDropdown((dropdown) => {
      dropdown.addOption("us", "美式").addOption("uk", "英式").setValue(this.plugin.settings.wordAudioAccent || "us").onChange(async (value) => {
        this.plugin.settings.wordAudioAccent = value === "uk" ? "uk" : "us";
        this.plugin.settings.speechLang = value === "uk" ? "en-GB" : "en-US";
        await this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName("语音回退语言").setDesc("仅在发音链接无法播放时使用").addText((text) => {
      text.setPlaceholder("en-US").setValue(this.plugin.settings.speechLang || "en-US").onChange(async (value) => {
        this.plugin.settings.speechLang = value.trim() || (this.plugin.settings.wordAudioAccent === "uk" ? "en-GB" : "en-US");
        await this.plugin.saveSettings();
      });
    });
  }
};
/*
object-assign
(c) Sindre Sorhus
@license MIT
*/
/*!

JSZip v3.10.1 - A JavaScript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.

JSZip uses the library pako released under the MIT license :
https://github.com/nodeca/pako/blob/main/LICENSE
*/
/*!
    localForage -- Offline Storage, Improved
    Version 1.10.0
    https://localforage.github.io/localForage
    (c) 2013-2017 Mozilla, Apache License 2.0
*/
/**
 * @license React
 * react-dom.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * @license React
 * react.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * @license React
 * scheduler.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
/**
 * Checks if an event is supported in the current execution environment.
 *
 * NOTE: This will not work correctly for non-generic events such as `change`,
 * `reset`, `load`, `error`, and `select`.
 *
 * Borrows from Modernizr.
 *
 * @param {string} eventNameSuffix Event name, e.g. "click".
 * @return {boolean} True if the event is supported.
 * @internal
 * @license Modernizr 3.0.0pre (Custom Build) | MIT
 */
/** @license React v16.13.1
 * react-is.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* nosourcemap */