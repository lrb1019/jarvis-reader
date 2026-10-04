/** Search file names and EPUB metadata without changing the displayed book name. */
export function matchesBookSearch(query: string, fields: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some(field => field?.toLowerCase().includes(needle));
}
