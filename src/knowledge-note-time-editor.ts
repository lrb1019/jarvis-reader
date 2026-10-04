import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";

import { knowledgeNoteTimeLines } from "./knowledge-note";

export const knowledgeNoteTimeEditor = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate): void {
    if (update.docChanged
      || update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)
      || update.startState.field(editorInfoField, false)?.file !== update.state.field(editorInfoField, false)?.file) {
      this.decorations = this.build(update.view);
    }
  }
  private build(view: EditorView): DecorationSet {
    if (!view.state.field(editorLivePreviewField, false) || !view.state.field(editorInfoField, false)?.file) return Decoration.none;
    return Decoration.set(knowledgeNoteTimeLines(view.state.doc.toString()).map((number) =>
      Decoration.line({ class: "jarvis-knowledge-note-time-line" }).range(view.state.doc.line(number).from),
    ));
  }
}, { decorations: (plugin) => plugin.decorations });
