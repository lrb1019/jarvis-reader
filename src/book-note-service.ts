import type { BookHighlight } from "./types.ts";
import type { HighlightNoteDetails } from "./highlights.ts";

export interface BookNoteOperations {
  appendHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void>;
  appendReflection(noteFile: unknown, highlight: BookHighlight, reflection: string): Promise<void>;
  replaceHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void>;
  deleteHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void>;
  readHighlightDetails(noteFile: unknown, highlight: BookHighlight): Promise<HighlightNoteDetails>;
}

export class BookNoteService {
  private readonly operations: BookNoteOperations;

  constructor(operations: BookNoteOperations) {
    this.operations = operations;
  }

  appendHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void> {
    return this.operations.appendHighlight(noteFile, highlight);
  }

  appendReflection(noteFile: unknown, highlight: BookHighlight, reflection: string): Promise<void> {
    return this.operations.appendReflection(noteFile, highlight, reflection);
  }

  replaceHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void> {
    return this.operations.replaceHighlight(noteFile, highlight);
  }

  deleteHighlight(noteFile: unknown, highlight: BookHighlight): Promise<void> {
    return this.operations.deleteHighlight(noteFile, highlight);
  }

  readHighlightDetails(noteFile: unknown, highlight: BookHighlight): Promise<HighlightNoteDetails> {
    return this.operations.readHighlightDetails(noteFile, highlight);
  }
}
