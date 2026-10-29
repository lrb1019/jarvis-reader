import { PluginSettingTab, Setting, FuzzySuggestModal, TFolder, Notice, App, setIcon } from "obsidian";
import { DEFAULT_BOOK_NOTE_TEMPLATE } from "./book-note-template";
import { DEFAULT_STORAGE_FOLDERS, type StorageFolders } from "./storage-folders";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE, TRANSLATION_PROMPT_HELP_TEXT } from "./word-assets";
import { normalizeTranslationProvider, getTranslationProviderDefaults, validateTranslationPromptJsonTemplate, translateSelectionWithApi } from "./translation";
import type JarvisReaderPlugin from "./main";
import { clampReaderZoom, clampReaderLineHeight, READER_ZOOM_LIMITS, READER_LINE_HEIGHT_LIMITS, READER_WIDTH_LIMITS } from "./reader-settings";
import { getOfflineDictionaryService } from "./dictionary-service";
import { DICTIONARY_PACKAGE_LIMIT } from "./dictionary-package";

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
  bookFolder: "",
  bookNoteFolder: DEFAULT_STORAGE_FOLDERS.bookNoteFolder,
  knowledgeNoteFolder: DEFAULT_STORAGE_FOLDERS.knowledgeNoteFolder,
  bookNoteTemplate: DEFAULT_BOOK_NOTE_TEMPLATE,
  customCoverFolder: DEFAULT_STORAGE_FOLDERS.customCoverFolder,
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
class JarvisReaderFolderSuggestModal extends FuzzySuggestModal<string> {
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
  private dictionaryImporting = false;
  
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
    
    const tabsContainer = headerDiv.createDiv("jarvis-settings-tabs-container");
    
    const tabs = [
      { 
        id: "storage", 
        label: "笔记与文件",
        icon: "folder"
      },
      { 
        id: "translation", 
        label: "翻译服务",
        icon: "sparkles"
      },
      { 
        id: "words", 
        label: "词典与词卡",
        icon: "volume-2"
      },
      { 
        id: "appearance", 
        label: "阅读外观",
        icon: "panels-top-left"
      },
    ];

    tabs.forEach(tab => {
      const tabEl = tabsContainer.createEl("button", {
        cls: "jarvis-settings-tab",
        attr: { type: "button", "aria-current": this.activeTab === tab.id ? "page" : "false" }
      });
      setIcon(tabEl.createSpan({ cls: "jarvis-settings-tab-icon", attr: { "aria-hidden": "true" } }), tab.icon);
      tabEl.createSpan({ text: tab.label });
      tabEl.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    });

    const contentDiv = containerEl.createDiv("jarvis-settings-content");

    if (this.activeTab === "storage") {
      new Setting(contentDiv).setName("书籍与文件夹").setHeading();
      const draft: StorageFolders = {
        bookFolder: this.plugin.settings.bookFolder || "",
        bookNoteFolder: this.plugin.settings.bookNoteFolder,
        knowledgeNoteFolder: this.plugin.settings.knowledgeNoteFolder,
        customCoverFolder: this.plugin.settings.customCoverFolder
      };
      const inputs = new Map<keyof StorageFolders, import("obsidian").TextComponent>();
      const rows: { key: keyof StorageFolders; name: string; placeholder: string }[] = [
        { key: "bookFolder", name: "书籍文件夹", placeholder: "留空为整个仓库" },
        { key: "bookNoteFolder", name: "读书笔记", placeholder: "Reading Notes" },
        { key: "knowledgeNoteFolder", name: "知识笔记", placeholder: "Knowledge Notes" },
        { key: "customCoverFolder", name: "封面", placeholder: "Cover" }
      ];
      for (const row of rows) {
        const setting = new Setting(contentDiv).setName(row.name);
        if (row.key === "bookFolder") setting.setDesc("仅用于筛选书架，其他目录独立设置。");
        setting.addText(text => {
          inputs.set(row.key, text);
          text.setPlaceholder(row.placeholder).setValue(draft[row.key]).onChange(value => {
            draft[row.key] = value;
          });
        }).addExtraButton(button => button.setIcon("folder-open").setTooltip("选择文件夹").onClick(() => {
          new JarvisReaderFolderSuggestModal(this.app, path => {
            draft[row.key] = path;
            inputs.get(row.key)?.setValue(path);
          }).open();
        }));
      }
      new Setting(contentDiv).addButton(button => button.setButtonText("保存并创建文件夹").setCta().onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.configureStorageFolders(draft);
          new Notice("文件夹设置已保存");
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "文件夹设置保存失败");
        } finally { button.setDisabled(false); }
      }));

      new Setting(contentDiv).setName("读书笔记初始模板").setDesc("仅用于新建笔记。{{toc}} 可预填目录；摘录格式由插件维护。支持 {{bookname}} {{title}} {{extension}} {{created}} {{toc}}")
        .setClass("jarvis-settings-book-note-template").addTextArea((text) => {
        text.setPlaceholder(DEFAULT_BOOK_NOTE_TEMPLATE).setValue(this.plugin.settings.bookNoteTemplate || "").onChange(async (value) => {
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
      this.renderDictionarySetting(contentDiv);
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
  private renderDictionarySetting(containerEl: HTMLElement): void {
    const service = getOfflineDictionaryService(this.app);
    new Setting(containerEl).setName("离线词典").setHeading();
    const row = new Setting(containerEl).setName("ECDICT").setDesc(this.dictionaryImporting ? "正在导入词典…" : "正在检查安装状态…");
    row.descEl.setAttribute("role", "status");
    const refresh = async () => {
      const status = await service.status(true);
      if (row.settingEl.isConnected && !this.dictionaryImporting) row.setDesc(status.state === "ready"
        ? `已安装 · ${status.version}。查词无需联网，插件更新时保留。`
        : status.message);
    };
    void refresh();
    row.addButton(button => button.setButtonText("导入词典包").setDisabled(this.dictionaryImporting).onClick(() => {
      const input = row.controlEl.createEl("input", { type: "file", attr: { accept: ".zip,application/zip", "aria-label": "选择 ECDICT 词典包" } });
      input.hidden = true;
      input.addEventListener("cancel", () => input.remove(), { once: true });
      input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file || this.dictionaryImporting) return;
        if (file.size > DICTIONARY_PACKAGE_LIMIT) { new Notice("请选择不超过 64 MB 的词典包。"); return; }
        this.dictionaryImporting = true;
        button.setDisabled(true);
        row.setDesc("正在校验并导入，原词典会保留至导入成功。");
        try {
          const version = await service.importPackage(await file.arrayBuffer(), done => row.setDesc(`正在校验并导入 ${done}/26…`));
          new Notice(`离线词典已安装：${version}`);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "词典导入失败，原词典未替换。");
        } finally {
          this.dictionaryImporting = false;
          button.setDisabled(false);
          await refresh();
        }
      };
      input.click();
    }));
    const help = containerEl.createEl("p", { cls: "setting-item-description" });
    help.appendText("从 ");
    help.createEl("a", { text: "GitHub 发布页", href: "https://github.com/lrb1019/jarvis-reader/releases", attr: { target: "_blank", rel: "noopener noreferrer" } });
    help.appendText(" 下载 jarvis-reader-ecdict-*.zip 后导入。只在你选择文件后安装，不自动下载；已有词典可继续使用。");
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
