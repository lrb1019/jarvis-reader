import { PluginSettingTab, Setting, FuzzySuggestModal, TFolder, Notice, App } from "obsidian";
import { normalizeVaultPath } from "./utils";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE, TRANSLATION_PROMPT_HELP_TEXT } from "./word-assets";
import { normalizeTranslationProvider, getTranslationProviderDefaults, validateTranslationPromptJsonTemplate, translateSelectionWithApi } from "./translation";
import type JarvisReaderPlugin from "./main";

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
  scrolledView: false,
  singlePageView: false,
  readerZoom: 1,
  readerLineHeight: 1.6,
  bookNoteFolder: "",
  bookNoteTemplate: DEFAULT_BOOK_NOTE_TEMPLATE,
  customCoverFolder: "00-Attachment",
  wordBookExportFolder: "",
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
  autoPlayAudioOnReview: true,
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
    sentence: "#40c057",
    comment: "#f97316",
    normal: "#ffeb3b"
  },
  readingStats: {},
  wordReviewStats: {},
  sm2StartingEase: 2.5,
  sm2EasyBonus: 1.3,
  sm2LapseMultiplier: 0.5,
  sm2MaxInterval: 365
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
    tabsContainer.style.display = "flex";
    tabsContainer.style.gap = "16px";
    tabsContainer.style.borderBottom = "1px solid var(--background-modifier-border)";
    
    const tabs = [
      { 
        id: "storage", 
        label: "目录与文件",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"></path></svg>`
      },
      { 
        id: "translation", 
        label: "AI 与翻译",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>`
      },
      { 
        id: "words", 
        label: "词句发音与显示",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`
      },
      { 
        id: "appearance", 
        label: "阅读器与外观",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`
      },
      { 
        id: "review", 
        label: "记忆与复习",
        icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`
      }
    ];

    tabs.forEach(tab => {
      const tabEl = tabsContainer.createDiv("jarvis-settings-tab");
      tabEl.innerHTML = tab.icon + tab.label;
      tabEl.style.display = "inline-flex";
      tabEl.style.alignItems = "center";
      tabEl.style.cursor = "pointer";
      tabEl.style.padding = "6px 2px";
      tabEl.style.fontWeight = "500";
      tabEl.style.fontSize = "13px";
      tabEl.style.color = this.activeTab === tab.id ? "var(--text-accent)" : "var(--text-muted)";
      tabEl.style.borderBottom = this.activeTab === tab.id ? "2px solid var(--text-accent)" : "2px solid transparent";
      tabEl.style.transition = "all 0.15s ease";
      
      tabEl.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    });

    const contentDiv = containerEl.createDiv("jarvis-settings-content");

    if (this.activeTab === "storage") {
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

      let exportFolderText: any = null;
      new Setting(contentDiv).setName("阅读积累导出文件夹").setDesc("选择英语词条导出的 Markdown 笔记存放路径（相对于 Vault 根目录）").addText((text) => {
        exportFolderText = text;
        text.setPlaceholder("如: Export/Wordbooks").setValue(this.plugin.settings.wordBookExportFolder || "").onChange(async (value) => {
          this.plugin.settings.wordBookExportFolder = normalizeVaultPath(value);
          await this.plugin.saveSettings();
        });
      }).addButton((button) => button.setButtonText("选择").onClick(() => {
        new JarvisReaderFolderSuggestModal(this.app, async (path) => {
          this.plugin.settings.wordBookExportFolder = path;
          await this.plugin.saveSettings();
          if (exportFolderText) {
            exportFolderText.setValue(path);
          }
        }).open();
      })).addButton((button) => button.setButtonText("清除").onClick(async () => {
        this.plugin.settings.wordBookExportFolder = "";
        await this.plugin.saveSettings();
        if (exportFolderText) {
          exportFolderText.setValue("");
        }
      }));

      new Setting(contentDiv).setName("读书笔记模板").setDesc("支持 {{bookname}} {{title}} {{extension}} {{created}} {{toc}}").addTextArea((text) => {
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
        text.inputEl.rows = 13;
        text.inputEl.style.width = "100%";
      });

      new Setting(contentDiv).setName("自动标记单词").setDesc("开启后，在 EPUB 阅读器中会自动使用蓝色下划线标记已保存的单词。").addToggle((toggle) => toggle.setValue(this.plugin.settings.enableAutoHighlight !== false).onChange(async (value) => {
        this.plugin.settings.enableAutoHighlight = value;
        await this.plugin.saveSettings();
      }));
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

      new Setting(contentDiv).setName("模糊词句卡片正文").setDesc("只模糊可滚动的词句卡片正文；鼠标悬停后显示，标题和来源始终可见").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.blurWordCardBody).onChange(async (value) => {
        this.plugin.settings.blurWordCardBody = value;
        await this.plugin.saveSettings();
      }));

      new Setting(contentDiv).setName("启用单词发音").setDesc("优先使用发音链接；失败时回退到浏览器语音合成").addToggle((toggle) => toggle.setValue(!!this.plugin.settings.enableWordAudio).onChange(async (value) => {
        this.plugin.settings.enableWordAudio = value;
        await this.plugin.saveSettings();
      }));

      new Setting(contentDiv).setName("复习时自动发音").setDesc("打开记忆卡片时自动播放单词读音").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoPlayAudioOnReview !== false).onChange(async (value) => {
        this.plugin.settings.autoPlayAudioOnReview = value;
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
        slider.setLimits(0.5, 3.0, 0.1).setValue(this.plugin.settings.readerZoom || 1).setDynamicTooltip().onChange(async (value) => {
          this.plugin.settings.readerZoom = value;
          await this.plugin.saveSettings();
        });
      });

      new Setting(contentDiv).setName("阅读器默认行高").setDesc("全局控制阅读器中文字的行间距").addSlider((slider) => {
        slider.setLimits(1.0, 3.0, 0.1).setValue(this.plugin.settings.readerLineHeight || 1.6).setDynamicTooltip().onChange(async (value) => {
          this.plugin.settings.readerLineHeight = value;
          await this.plugin.saveSettings();
        });
      });

      const createColorPicker = (name: string, desc: string, key: "word" | "phrase" | "sentence" | "comment" | "normal") => {
        new Setting(contentDiv)
          .setName(name)
          .setDesc(desc)
          .addColorPicker(picker => picker
            .setValue(this.plugin.settings.highlightColors?.[key] || DEFAULT_SETTINGS.highlightColors[key])
            .onChange(async (value) => {
              this.plugin.settings.highlightColors = {
                ...(this.plugin.settings.highlightColors || DEFAULT_SETTINGS.highlightColors),
                [key]: value
              };
              await this.plugin.saveSettings();
              const event = new CustomEvent("jarvis-reader-colors-changed", { detail: this.plugin.settings.highlightColors });
              window.dispatchEvent(event);
            })
          );
      };

      createColorPicker("单词颜色", "自动识别的单词高亮底色", "word");
      createColorPicker("短语颜色", "自动识别的短语高亮底色", "phrase");
      createColorPicker("句子颜色", "自动识别的句子高亮底色", "sentence");
      createColorPicker("笔记颜色", "带有笔记的划线颜色", "comment");
      createColorPicker("默认高亮颜色", "普通的文本划线颜色", "normal");
    }
    
    if (this.activeTab === "review") {
      new Setting(contentDiv)
        .setName("起始难度 (Starting Ease)")
        .setDesc("新词条初次复习成功后的初始难度系数（默认值 2.5）")
        .addText((text) => {
          text.setPlaceholder("2.5")
            .setValue(String(this.plugin.settings.sm2StartingEase ?? 2.5))
            .onChange(async (value) => {
              const parsed = parseFloat(value);
              this.plugin.settings.sm2StartingEase = isNaN(parsed) || parsed <= 0 ? 2.5 : parsed;
              await this.plugin.saveSettings();
            });
          text.inputEl.addEventListener("blur", () => {
            text.setValue(String(this.plugin.settings.sm2StartingEase ?? 2.5));
          });
        });

      new Setting(contentDiv)
        .setName("简单奖励系数 (Easy Bonus)")
        .setDesc("点击“简单”评分时，对复习间隔的额外拉长倍数（默认值 1.3）")
        .addText((text) => {
          text.setPlaceholder("1.3")
            .setValue(String(this.plugin.settings.sm2EasyBonus ?? 1.3))
            .onChange(async (value) => {
              const parsed = parseFloat(value);
              this.plugin.settings.sm2EasyBonus = isNaN(parsed) || parsed <= 0 ? 1.3 : parsed;
              await this.plugin.saveSettings();
            });
          text.inputEl.addEventListener("blur", () => {
            text.setValue(String(this.plugin.settings.sm2EasyBonus ?? 1.3));
          });
        });

      new Setting(contentDiv)
        .setName("困难扣减系数 (Lapse Multiplier)")
        .setDesc("点击“困难”评分时，当前复习间隔的缩减比例。范围需在 0 到 1 之间（默认值 0.5，如 0.5 表示间隔缩短一半）")
        .addText((text) => {
          text.setPlaceholder("0.5")
            .setValue(String(this.plugin.settings.sm2LapseMultiplier ?? 0.5))
            .onChange(async (value) => {
              const parsed = parseFloat(value);
              this.plugin.settings.sm2LapseMultiplier = isNaN(parsed) || parsed <= 0 || parsed > 1 ? 0.5 : parsed;
              await this.plugin.saveSettings();
            });
          text.inputEl.addEventListener("blur", () => {
            text.setValue(String(this.plugin.settings.sm2LapseMultiplier ?? 0.5));
          });
        });

      new Setting(contentDiv)
        .setName("最大复习间隔 (Maximum Interval)")
        .setDesc("限制词条复习周期的上限时间，单位为天（默认值 365）")
        .addText((text) => {
          text.setPlaceholder("365")
            .setValue(String(this.plugin.settings.sm2MaxInterval ?? 365))
            .onChange(async (value) => {
              const parsed = parseInt(value, 10);
              this.plugin.settings.sm2MaxInterval = isNaN(parsed) || parsed <= 0 ? 365 : parsed;
              await this.plugin.saveSettings();
            });
          text.inputEl.addEventListener("blur", () => {
            text.setValue(String(this.plugin.settings.sm2MaxInterval ?? 365));
          });
        });
    }
  }
}