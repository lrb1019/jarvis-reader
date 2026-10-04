import type { App, TFile } from "obsidian";
import { getOrCreateBookNote } from "./book-notes";
import { formatDuration } from "./utils";
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
    projectReadingTime: async (bookFile, totalSeconds, settings) => {
      const noteFile = await getOrCreateBookNote(app, bookFile as TFile, "", settings);
      if (noteFile) {
        await app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
          frontmatter.reading_time = formatDuration(totalSeconds);
        });
      }
    },
    appendHighlight: (noteFile, highlight) => appendHighlightToBookNote(app, noteFile as TFile, highlight),
    appendReflection: (noteFile, highlight, reflection) => appendReflectionToBookNote(app, noteFile as TFile, highlight, reflection),
    replaceHighlight: (noteFile, highlight, expected) => replaceHighlightInBookNote(app, noteFile as TFile, highlight, expected),
    deleteHighlight: (noteFile, highlight) => deleteHighlightFromBookNote(app, noteFile as TFile, highlight),
    readHighlightDetails: (noteFile, highlight) => readHighlightNoteDetailsFromBookNote(app, noteFile as TFile, highlight),
  };
}
