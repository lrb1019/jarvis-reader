import { Component, MarkdownRenderer, Modal, type App } from "obsidian";
import type { WordAsset } from "../domain/index.ts";

export class WordCardModal extends Modal {
  private readonly renderComponent = new Component();

  constructor(
    app: App,
    private readonly asset: WordAsset,
    private readonly openNote?: (asset: WordAsset) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.renderComponent.load();
    this.titleEl.setText(this.asset.title || this.asset.lemma);
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
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}
