import type { App, TFile } from "obsidian";
import type { BookHighlight } from "./types.ts";
import type { BookNoteOperations } from "./book-note-service.ts";
import {
  appendHighlightToBookNote,
  appendReflectionToBookNote,
  deleteHighlightFromBookNote,
  readHighlightNoteDetailsFromBookNote,
  replaceHighlightInBookNote,
} from "./highlights.ts";

export function createBookNoteOperations(app: App): BookNoteOperations {
  return {
    appendHighlight: (noteFile, highlight) => appendHighlightToBookNote(app, noteFile as TFile, highlight),
    appendReflection: (noteFile, highlight, reflection) => appendReflectionToBookNote(app, noteFile as TFile, highlight, reflection),
    replaceHighlight: (noteFile, highlight, expected) => replaceHighlightInBookNote(app, noteFile as TFile, highlight, expected),
    deleteHighlight: (noteFile, highlight) => deleteHighlightFromBookNote(app, noteFile as TFile, highlight),
    readHighlightDetails: (noteFile, highlight) => readHighlightNoteDetailsFromBookNote(app, noteFile as TFile, highlight),
  };
}
