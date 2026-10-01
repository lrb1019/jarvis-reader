// A missing association must remain visible without taking down the entire library.
export function projectLibraryBookNotes<Book extends { path: string }, Note>(
  books: readonly Book[],
  find: (book: Book) => Note | null
): { notes: Record<string, Note>; issues: Record<string, string> } {
  const notes: Record<string, Note> = {};
  const issues: Record<string, string> = {};
  for (const book of books) {
    try {
      const note = find(book);
      if (note) notes[book.path] = note;
    } catch (error) {
      issues[book.path] = error instanceof Error ? error.message : "读书笔记读取失败";
    }
  }
  return { notes, issues };
}
