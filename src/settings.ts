import { PluginSettingTab, Setting, FuzzySuggestModal, TFolder, Notice, App } from "obsidian";
import { normalizeVaultPath } from "./utils";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE, TRANSLATION_PROMPT_HELP_TEXT } from "./word-assets";
import { normalizeTranslationProvider, getTranslationProviderDefaults, validateTranslationPromptJsonTemplate, translateSelectionWithApi } from "./translation";
import type JarvisReaderPlugin from "./main";
import { clampReaderZoom, clampReaderLineHeight, READER_ZOOM_LIMITS, READER_LINE_HEIGHT_LIMITS, READER_WIDTH_LIMITS } from "./reader-settings";

export const DEFAULT_BOOK_NOTE_TEMPLATE = `---
bookname: "[[{{bookname}}]]"
status: unread
rating: 0
tags: []
start_date: ""
finish_date: ""
created: {{created}}
---

{{toc}}`;

export const DEFAULT_SETTINGS = {
  readerLetterSpacing: 0,
  readerWordSpacing: 0,
  readerParagraphIndent: "original",
  readerWidth: READER_WIDTH_LIMITS.defaultValue,
  scrolledView: false,
  singlePageView: false,
  readerZoom: READER_ZOOM_LIMITS.defaultValue,
  readerLineHeight: READER_LINE_HEIGHT_LIMITS.defaultValue,
  readerQuickActions: ["bookmark", "note"],
  bookNoteFolder: "",
  knowledgeNoteFolder: "知识库/想法",
  bookNoteTemplate: DEFAULT_BOOK_NOTE_TEMPLATE,
  customCoverFolder: "00-Attachment",
  wordAssets: {},
  translationApi: {
    provider: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    model: ""
  },
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  enableAutoHighlight: true,
  enableWordAudio: true,
  wordAudioTemplate: DEFAULT_WORD_AUDIO_TEMPLATE,
  wordAudioAccent: "us",
  blurWordCardBody: true,
  speechLang: "en-US",
  bookInitLocations: {},
  bookHighlights: {},
  bookProgress: {},
  bookBookmarks: {},
  bookCoverCache: {},
  sidebarLayoutMode: "single",
  sidebarPaneSplit: 48,
  bookshelfCoverOnly: false,
  highlightColors: {
    word: "#4dabf7",
    phrase: "#ae3ec9",
    comment: "#f97316",
    normal: "#ffeb3b"
  },
  readingStats: {}
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
  activeTab: string = "storage";
  
  constructor(app: App, plugin: JarvisReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    
    // Header and Tabs
    const headerDiv = containerEl.createDiv();
    headerDiv.style.display = "flex";
    headerDiv.style.flexDirection = "column";
    headerDiv.style.gap = "15px";
    headerDiv.style.marginBottom = "20px";
    
    const titleEl = headerDiv.createEl("h2", { text: "Jarvis Reader 设置", cls: "jarvis-reader-settings-title" });
    titleEl.style.fontSize = "1.25em";
    titleEl.style.fontWeight = "600";
    titleEl.style.margin = "0";
    titleEl.style.color = "var(--text-normal)";
    
    const tabsContainer = headerDiv.createDiv("jarvis-settings-tabs-container");
    
    const tabs = [
      { 
        id: "storage", 
        label: "笔记与文件",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"></path></svg>`
      },
      { 
        id: "translation", 
        label: "翻译服务",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>`
      },
      { 
        id: "words", 
        label: "词卡标记与发音",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
      },
      { 
        id: "appearance", 
        label: "阅读外观",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`
      },
    ];

    tabs.forEach(tab => {
      const tabEl = tabsContainer.createEl("button", {
        cls: "jarvis-settings-tab",
        attr: { type: "button", "aria-current": this.activeTab === tab.id ? "page" : "false" }
      });
      tabEl.innerHTML = tab.icon + tab.label;
      tabEl.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    });

    const contentDiv = containerEl.createDiv("jarvis-settings-content");

    if (this.activeTab === "storage") {
      new Setting(contentDiv).setName("读书笔记").setHeading();
      let bookFolderText: any = null;
      new Setting(contentDiv).setName("读书笔记文件夹").setDesc("保存自动生成读书笔记的文件夹").addText((text) => {
        bookFolderText = text;
        text.setPlaceholder("选择或输入文件夹").setValue(this.plugin.settings.bookNoteFolder || "").onChange(async (value) => {
          this.plugin.settings.bookNoteFolder = normalizeVaultPath(value);
          await this.plugin.saveSettings();
        });
      }).addButton((button) => button.setButtonText("选择").onClick(() => {
        new JarvisReaderFolderSuggestModal(this.app, async (path) => {
          this.plugin.settings.bookNoteFolder = path;
          await this.plugin.saveSettings();
          if (bookFolderText) {
            bookFolderText.setValue(path);
          }
        }).open();
      })).addButton((button) => button.setButtonText("清除").onClick(async () => {
        this.plugin.settings.bookNoteFolder = "";
        await this.plugin.saveSettings();
        if (bookFolderText) {
          bookFolderText.setValue("");
        }
      }));

      new Setting(contentDiv).setName("知识笔记").setHeading();
      let knowledgeFolderText: any = null;
      new Setting(contentDiv).setName("知识笔记默认目录").setDesc("将阅读笔记提升为独立知识笔记时，自动创建到此目录。留空则创建到仓库根目录。").addText((text) => {
        knowledgeFolderText = text;
        text.setPlaceholder("如: 知识库/想法").setValue(this.plugin.settings.knowledgeNoteFolder || "").onChange(async (value) => {
          this.plugin.settings.knowledgeNoteFolder = normalizeVaultPath(value);
          await this.plugin.saveSettings();
        });
      }).addButton((button) => button.setButtonText("选择").onClick(() => {
        new JarvisReaderFolderSuggestModal(this.app, async (path) => {
          this.plugin.settings.knowledgeNoteFolder = path;
          await this.plugin.saveSettings();
          knowledgeFolderText?.setValue(path);
        }).open();
      }));

      new Setting(contentDiv).setName("其他文件").setHeading();
      let customCoverFolderText: any = null;
      new Setting(contentDiv).setName("自定义封面文件夹").setDesc("保存自定义图书封面的文件夹路径").addText((text) => {
        customCoverFolderText = text;
        text.setPlaceholder("00-Attachment").setValue(this.plugin.settings.customCoverFolder || "").onChange(async (value) => {
          this.plugin.settings.customCoverFolder = normalizeVaultPath(value);
          await this.plugin.saveSettings();
        });
      }).addButton((button) => button.setButtonText("选择").onClick(() => {
        new JarvisReaderFolderSuggestModal(this.app, async (path) => {
          this.plugin.settings.customCoverFolder = path;
          await this.plugin.saveSettings();
          if (customCoverFolderText) {
            customCoverFolderText.setValue(path);
          }
        }).open();
      })).addButton((button) => button.setButtonText("清除").onClick(async () => {
        this.plugin.settings.customCoverFolder = "";
        await this.plugin.saveSettings();
        if (customCoverFolderText) {
          customCoverFolderText.setValue("");
        }
      }));

      new Setting(contentDiv).setName("读书笔记模板").setDesc("支持 {{bookname}} {{title}} {{extension}} {{created}} {{toc}}")
        .setClass("jarvis-settings-book-note-template").addTextArea((text) => {
        text.setPlaceholder(`---
bookname: "[[{{bookname}}]]"
status: unread
rating: 0
tags: []
start_date: ""
finish_date: ""
created: {{created}}
---

{{toc}}`).setValue(this.plugin.settings.bookNoteTemplate || "").onChange(async (value) => {
          this.plugin.settings.bookNoteTemplate = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 7;
      });

    }
    
    if (this.activeTab === "translation") {
      let translationBaseUrlText: any = null;
      let translationModelText: any = null;
      let translationPromptText: any = null;

      new Setting(contentDiv).setName("翻译服务").setDesc("选择 API 格式，自定义 URL 会自动识别类型").addDropdown((dropdown) => {
        dropdown.addOption("openai-compatible", "OpenAI 兼容")
          .addOption("anthropic", "Anthropic Claude")
          .addOption("gemini", "Google Gemini")
          .addOption("deepseek", "深度求索 (DeepSeek)")
          .addOption("zhipu", "智谱清言 (GLM)")
          .addOption("qwen", "通义千问 (Qwen)")
          .addOption("moonshot", "Kimi (Moonshot)")
          .addOption("minimax", "MiniMax")
          .addOption("custom", "自定义")
          .setValue((this.plugin.settings.translationApi || {}).provider || "openai-compatible").onChange(async (value) => {
          const provider = value;
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

      new Setting(contentDiv).setName("翻译 API 基础地址").setDesc("服务商基础地址；插件会按所选服务自动追加请求路径").addText((text) => {
        translationBaseUrlText = text;
        const defaults = getTranslationProviderDefaults((this.plugin.settings.translationApi || {}).provider);
        text.setPlaceholder(defaults.baseUrl || "https://...").setValue((this.plugin.settings.translationApi || {}).baseUrl || "").onChange(async (value) => {
          this.plugin.settings.translationApi.baseUrl = value.trim();
          await this.plugin.saveSettings();
        });
        text.inputEl.style.width = "100%";
      });

      new Setting(contentDiv).setName("翻译 API 密钥").setDesc("用于请求翻译服务的访问密钥").addText((text) => {
        text.setPlaceholder("sk-...").setValue((this.plugin.settings.translationApi || {}).apiKey || "").onChange(async (value) => {
          this.plugin.settings.translationApi.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
        text.inputEl.type = "password";
        text.inputEl.style.width = "100%";
      });

      new Setting(contentDiv).setName("翻译模型").setDesc("当前服务使用的模型 ID").addText((text) => {
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
        } catch (error: any) {
          new Notice(`翻译测试失败：${error.message || error}`);
        }
      }));

      contentDiv.createDiv({
        cls: "jarvis-reader-translation-prompt-help",
        text: TRANSLATION_PROMPT_HELP_TEXT
      });

      new Setting(contentDiv).setName("翻译提示词").setDesc("用于生成单词释义的提示词").addTextArea((text) => {
        translationPromptText = text;
        text.setValue(this.plugin.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT).onChange(async (value) => {
          this.plugin.settings.translationPrompt = value || DEFAULT_TRANSLATION_PROMPT;
          await this.plugin.saveSettings();
        });
        text.inputEl.rows = 6;
        text.inputEl.style.width = "100%";
      });

      new Setting(contentDiv).setName("").setDesc("").addButton((button) => button.setButtonText("恢复默认提示词").onClick(async () => {
        this.plugin.settings.translationPrompt = DEFAULT_TRANSLATION_PROMPT;
        await this.plugin.saveSettings();
        if (translationPromptText) {
          translationPromptText.setValue(DEFAULT_TRANSLATION_PROMPT);
        }
        new Notice("已恢复默认翻译提示词。");
      }));
    }

    if (this.activeTab === "words") {
      new Setting(contentDiv).setName("已保存词卡的标记").setHeading();
      new Setting(contentDiv).setName("在书中标记已保存的词卡").setDesc("开启后，阅读器会标记已保存且能在当前书中定位的单词和短语；关闭后仍保留词卡记录。").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableAutoHighlight !== false).onChange(async (value) => {
        this.plugin.settings.enableAutoHighlight = value;
        await this.plugin.saveSettings();
      }));
      this.createColorPicker(contentDiv, "单词颜色", "已保存单词在阅读器中的标记颜色", "word");
      this.createColorPicker(contentDiv, "短语颜色", "已保存短语在阅读器中的标记颜色", "phrase");

      new Setting(contentDiv).setName("词卡").setHeading();
      new Setting(contentDiv).setName("模糊词卡正文").setDesc("只模糊可滚动的词卡正文；鼠标悬停后显示，标题和来源始终可见").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.blurWordCardBody).onChange(async (value) => {
        this.plugin.settings.blurWordCardBody = value;
        await this.plugin.saveSettings();
      }));

      new Setting(contentDiv).setName("发音").setHeading();
      new Setting(contentDiv).setName("启用单词发音").setDesc("优先使用发音链接；失败时回退到浏览器语音合成").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.enableWordAudio).onChange(async (value) => {
        this.plugin.settings.enableWordAudio = value;
        await this.plugin.saveSettings();
      }));

      new Setting(contentDiv).setName("发音链接模板").setDesc("可用 {{word}}、{{type}}、{{accent}}。有道 type：1 英式，2 美式。").addText((text) => {
        text.setPlaceholder(DEFAULT_WORD_AUDIO_TEMPLATE).setValue(this.plugin.settings.wordAudioTemplate || DEFAULT_WORD_AUDIO_TEMPLATE).onChange(async (value) => {
          this.plugin.settings.wordAudioTemplate = value.trim() || DEFAULT_WORD_AUDIO_TEMPLATE;
          await this.plugin.saveSettings();
        });
        text.inputEl.style.width = "100%";
      });

      new Setting(contentDiv).setName("发音口音").setDesc("选择美式或英式发音").addDropdown((dropdown) => {
        dropdown.addOption("us", "美式").addOption("uk", "英式").setValue(this.plugin.settings.wordAudioAccent || "us").onChange(async (value) => {
          this.plugin.settings.wordAudioAccent = value === "uk" ? "uk" : "us";
          this.plugin.settings.speechLang = value === "uk" ? "en-GB" : "en-US";
          await this.plugin.saveSettings();
        });
      });

      new Setting(contentDiv).setName("语音回退语言").setDesc("仅在发音链接无法播放时使用").addText((text) => {
        text.setPlaceholder("en-US").setValue(this.plugin.settings.speechLang || "en-US").onChange(async (value) => {
          this.plugin.settings.speechLang = value.trim() || (this.plugin.settings.wordAudioAccent === "uk" ? "en-GB" : "en-US");
          await this.plugin.saveSettings();
        });
      });
    }

    if (this.activeTab === "appearance") {

      new Setting(contentDiv).setName("阅读器默认缩放比例").setDesc("全局控制阅读器中文字的放大缩小级别").addSlider((slider) => {
        slider.setLimits(READER_ZOOM_LIMITS.min, READER_ZOOM_LIMITS.max, READER_ZOOM_LIMITS.step).setValue(clampReaderZoom(this.plugin.settings.readerZoom)).setDynamicTooltip().onChange(async (value) => {
          const nextValue = clampReaderZoom(value);
          slider.setValue(nextValue);
          this.plugin.settings.readerZoom = nextValue;
          await this.plugin.saveSettings();
        });
      });

      new Setting(contentDiv).setName("阅读器默认行高").setDesc("全局控制阅读器中文字的行间距").addSlider((slider) => {
        slider.setLimits(READER_LINE_HEIGHT_LIMITS.min, READER_LINE_HEIGHT_LIMITS.max, READER_LINE_HEIGHT_LIMITS.step).setValue(clampReaderLineHeight(this.plugin.settings.readerLineHeight)).setDynamicTooltip().onChange(async (value) => {
          const nextValue = clampReaderLineHeight(value);
          slider.setValue(nextValue);
          this.plugin.settings.readerLineHeight = nextValue;
          await this.plugin.saveSettings();
        });
      });

      new Setting(contentDiv).setName("划线颜色").setHeading();
      this.createColorPicker(contentDiv, "带笔记划线颜色", "给划线添加笔记后显示的颜色", "comment");
      this.createColorPicker(contentDiv, "普通划线颜色", "未添加笔记的普通划线颜色", "normal");
    }
    
  }
  private createColorPicker(containerEl: HTMLElement, name: string, desc: string, key: keyof typeof DEFAULT_SETTINGS.highlightColors): void {
    new Setting(containerEl).setName(name).setDesc(desc).addColorPicker((picker) => picker
      .setValue(this.plugin.settings.highlightColors?.[key] || DEFAULT_SETTINGS.highlightColors[key])
      .onChange(async (value) => {
        this.plugin.settings.highlightColors = {
          ...(this.plugin.settings.highlightColors || DEFAULT_SETTINGS.highlightColors),
          [key]: value
        };
        await this.plugin.saveSettings();
        window.dispatchEvent(new CustomEvent("jarvis-reader-colors-changed", { detail: this.plugin.settings.highlightColors }));
      }));
  }

}
