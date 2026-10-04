import type { BookHighlight, JarvisReaderSettings } from "./types.ts";
import type { HighlightNoteDetails, HighlightNoteInput } from "./book-note-document.ts";

export interface BookNoteOperations {
  projectReadingTime(bookFile: unknown, totalSeconds: number, settings: Partial<JarvisReaderSettings>): Promise<void>;
  appendHighlight(noteFile: unknown, highlight: HighlightNoteInput): Promise<void>;
  appendReflection(noteFile: unknown, highlight: BookHighlight, reflection: string): Promise<void>;
  replaceHighlight(noteFile: unknown, highlight: HighlightNoteInput, expected?: Pick<HighlightNoteDetails, "quote" | "commentEntries" | "aiSections">): Promise<void>;
  deleteHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void>;
  readHighlightDetails(noteFile: unknown, highlight: BookHighlight): Promise<HighlightNoteDetails>;
}

export class BookNoteService {
  private readonly operations: BookNoteOperations;

  constructor(operations: BookNoteOperations) {
    this.operations = operations;
  }

  projectReadingTime(bookFile: unknown, totalSeconds: number, settings: Partial<JarvisReaderSettings>): Promise<void> {
    return this.operations.projectReadingTime(bookFile, totalSeconds, settings);
  }

  appendHighlight(noteFile: unknown, highlight: HighlightNoteInput): Promise<void> {
    return this.operations.appendHighlight(noteFile, highlight);
  }

  appendReflection(noteFile: unknown, highlight: BookHighlight, reflection: string): Promise<void> {
    return this.operations.appendReflection(noteFile, highlight, reflection);
  }

  replaceHighlight(noteFile: unknown, highlight: HighlightNoteInput, expected?: Pick<HighlightNoteDetails, "quote" | "commentEntries" | "aiSections">): Promise<void> {
    return this.operations.replaceHighlight(noteFile, highlight, expected);
  }

  deleteHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void> {
    return this.operations.deleteHighlight(noteFile, highlight);
  }

  readHighlightDetails(noteFile: unknown, highlight: BookHighlight): Promise<HighlightNoteDetails> {
    return this.operations.readHighlightDetails(noteFile, highlight);
  }
}
