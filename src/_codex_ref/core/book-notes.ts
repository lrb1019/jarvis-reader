export interface BookNoteFileInfo {
  basename: string;
  extension: string;
  parentPath?: string | null;
}

export interface BookNoteSettings {
  bookNoteFolder?: string;
  bookNoteTemplate?: string;
}

export function normalizeBookNoteFolder(path: string | null | undefined): string {
  return String(path || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function formatBookNoteDate(value: Date): string {
  const pad = (number: number): string => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function getBookNotePath(file: BookNoteFileInfo, settings: BookNoteSettings = {}): string {
  const folder = normalizeBookNoteFolder(settings.bookNoteFolder) || normalizeBookNoteFolder(file.parentPath);
  return folder ? `${folder}/${file.basename}.md` : `${file.basename}.md`;
}

export function renderBookNoteContent(
  file: BookNoteFileInfo,
  toc: string,
  settings: BookNoteSettings = {},
  created = new Date(),
): string {
  const bookname = `${file.basename}.${file.extension}`;
  const createdText = formatBookNoteDate(created);
  const template = settings.bookNoteTemplate;
  if (!template?.trim()) {
    return `---\nbookname: "[[${bookname}]]"\ncreated: ${createdText}\n---\n\n${toc}`;
  }
  return template
    .replace(/\{\{bookname\}\}/g, bookname)
    .replace(/\{\{title\}\}/g, file.basename)
    .replace(/\{\{extension\}\}/g, file.extension)
    .replace(/\{\{created\}\}/g, createdText)
    .replace(/\{\{toc\}\}/g, toc || "");
}
