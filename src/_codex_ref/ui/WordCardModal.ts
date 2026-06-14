import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import type { WordAsset } from "../domain/index.ts";
import type { WordAudioOptions } from "../core/word-audio.ts";
import { playWordAudio, stopWordAudio } from "../core/word-audio.ts";

export class WordCardModal extends Modal {
  private readonly renderComponent = new Component();

  constructor(
    app: App,
    private readonly asset: WordAsset,
    private readonly openNote?: (asset: WordAsset) => Promise<void>,
    private readonly wordAudio?: WordAudioOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderComponent.load();
    this.titleEl.empty();
    const title = this.titleEl.createEl("button", {
      cls: "jarvis-reader-word-lemma jarvis-reader-word-lemma-button",
      text: this.asset.title || this.asset.lemma,
      attr: { title: "点击发音" },
    });
    title.disabled = !this.wordAudio?.enabled;
    title.addEventListener("click", () => {
      if (this.wordAudio) playWordAudio(this.asset.title || this.asset.lemma, this.wordAudio);
    });
    this.contentEl.empty();
    this.contentEl.addClass("jarvis-reader-global-word-card");
    void MarkdownRenderer.render(
      this.app,
      this.asset.display || this.asset.translation,
      this.contentEl,
      this.asset.notePath || "",
      this.renderComponent,
    );
    if (this.openNote) {
      const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
      const button = actions.createEl("button", { text: "打开词条" });
      button.addEventListener("click", () => {
        void this.openNote?.(this.asset).then(() => this.close());
      });
    }
  }

  onClose(): void {
    stopWordAudio();
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}
