import React from "react";

export type WordCardDisplayLineClassName =
  | "jarvis-reader-word-card-display-heading"
  | "jarvis-reader-word-card-display-quote"
  | "jarvis-reader-word-card-display-list"
  | "jarvis-reader-word-card-display-line";

export interface WordCardDisplayLineMeta {
  className: WordCardDisplayLineClassName;
  text: string;
}

export function renderWordCardDisplayText(text: unknown): React.ReactNode[] | string {
  const value = String(text || "");
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*|__)([\s\S]+?)\1/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(React.createElement("strong", { key: `bold-${parts.length}` }, match[2]));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  return parts.length ? parts : value;
}

export function getWordCardDisplayLineMeta(line: unknown): WordCardDisplayLineMeta {
  const raw = String(line || "");
  const trimmed = raw.trim();
  if (/^#{1,6}\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-heading",
      text: trimmed.replace(/^#{1,6}\s+/, "")
    };
  }
  if (/^>\s*/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-quote",
      text: trimmed.replace(/^>\s*/, "")
    };
  }
  if (/^(?:[-*]|\d+[.)])\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-list",
      text: trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, "")
    };
  }
  return {
    className: "jarvis-reader-word-card-display-line",
    text: raw
  };
}
