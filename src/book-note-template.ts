export const DEFAULT_BOOK_NOTE_TEMPLATE = `---
bookname: "[[{{bookname}}]]"
status: unread
rating: 0
tags: []
start_date: ""
finish_date: ""
created: {{created}}
---`;

export function renderBookNoteTemplate(
  template: string,
  file: { basename: string; extension: string },
  toc: string,
  created: string,
): string {
  const source = template.trim() ? template : DEFAULT_BOOK_NOTE_TEMPLATE;
  return source.replace(/\{\{bookname\}\}/g, `${file.basename}.${file.extension}`)
    .replace(/\{\{title\}\}/g, file.basename)
    .replace(/\{\{extension\}\}/g, file.extension)
    .replace(/\{\{created\}\}/g, created)
    .replace(/\{\{toc\}\}/g, toc || "");
}
