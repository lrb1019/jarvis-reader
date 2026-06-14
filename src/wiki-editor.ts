// Extracted from main.js L47199-47568

import React, { useRef, useEffect } from "react";

interface LinkCandidate {
  kind: "file" | "heading" | "block";
  title: string;
  path: string;
  insertText: string;
  recentIndex: number;
  modifiedTime: number;
}

interface WikiLinkRange {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  target: string;
}

interface CodeMirrorModules {
  state: any;
  view: any;
  autocomplete: any;
  commands: any;
}

interface WikiLinkCodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  candidates: LinkCandidate[];
  onOpenLink?: (target: string) => void;
  placeholder?: string;
}

export function getMarkdownLinkCandidates(app: any): LinkCandidate[] {
  var _a, _b;
  const files = (((_a = app == null ? void 0 : app.vault) == null ? void 0 : _a.getFiles) ? app.vault.getFiles() : []).filter((file: any) => {
    const path = (file.path || "").replace(/\\/g, "/");
    return path && !path.split("/").some((part: string) => part.startsWith("."));
  });
  const workspace = app == null ? void 0 : app.workspace;
  const recentPaths: any[] = [];
  if (workspace && Array.isArray(workspace.lastOpenFiles)) {
    recentPaths.push(...workspace.lastOpenFiles);
  }
  if (workspace && typeof workspace.getLastOpenFiles === "function") {
    const lastOpenFiles = workspace.getLastOpenFiles();
    if (Array.isArray(lastOpenFiles))
      recentPaths.push(...lastOpenFiles);
  }
  const recentRank = /* @__PURE__ */ new Map<string, number>();
  if (Array.isArray(recentPaths)) {
    recentPaths.forEach((path: any, index: number) => {
      const recentPath = typeof path === "string" ? path : path && typeof path.path === "string" ? path.path : "";
      if (recentPath) {
        const normalizedPath = recentPath.replace(/\\/g, "/").toLowerCase();
        if (!recentRank.has(normalizedPath))
          recentRank.set(normalizedPath, index);
        const pathWithoutExtension = normalizedPath.replace(/\.[^/.]+$/i, "");
        if (!recentRank.has(pathWithoutExtension))
          recentRank.set(pathWithoutExtension, index);
      }
    });
  }
  const basenameCounts = /* @__PURE__ */ new Map<string, number>();
  for (const file of files) {
    const title = file.basename || (file.name || "").replace(/\.[^/.]+$/i, "");
    const key = title.toLowerCase();
    basenameCounts.set(key, (basenameCounts.get(key) || 0) + 1);
  }
  const candidates: LinkCandidate[] = [];
  for (const file of files) {
    const title = file.basename || (file.name || "").replace(/\.[^/.]+$/i, "");
    const path = file.path || title;
    const pathWithoutExtension = path.replace(/\.[^/.]+$/i, "");
    const duplicate = (basenameCounts.get(title.toLowerCase()) || 0) > 1;
    const insertText = duplicate ? pathWithoutExtension : title;
    const pathKey = path.toLowerCase();
    const pathWithoutExtensionKey = pathWithoutExtension.toLowerCase();
    const recentIndex = recentRank.has(pathKey) ? recentRank.get(pathKey)! : recentRank.has(pathWithoutExtensionKey) ? recentRank.get(pathWithoutExtensionKey)! : Number.POSITIVE_INFINITY;
    const modifiedTime = file.stat && typeof file.stat.mtime === "number" ? file.stat.mtime : 0;
    candidates.push({
      kind: "file",
      title,
      path,
      insertText,
      recentIndex,
      modifiedTime
    });
    if ((file.extension || "").toLowerCase() !== "md")
      continue;
    const cache = ((_b = app == null ? void 0 : app.metadataCache) == null ? void 0 : _b.getFileCache) ? app.metadataCache.getFileCache(file) : null;
    for (const heading of (cache == null ? void 0 : cache.headings) || []) {
      const headingText = (heading == null ? void 0 : heading.heading) || "";
      if (!headingText.trim())
        continue;
      candidates.push({
        kind: "heading",
        title: `${title}#${headingText}`,
        path: `${path}#${headingText}`,
        insertText: `${insertText}#${headingText}`,
        recentIndex,
        modifiedTime
      });
    }
    const blocks = cache == null ? void 0 : cache.blocks;
    if (blocks && typeof blocks === "object") {
      for (const blockId of Object.keys(blocks)) {
        candidates.push({
          kind: "block",
          title: `${title}#^${blockId}`,
          path: `${path}#^${blockId}`,
          insertText: `${insertText}#^${blockId}`,
          recentIndex,
          modifiedTime
        });
      }
    }
  }
  return candidates.sort((a, b) => {
    const recentDelta = (a.recentIndex ?? Number.POSITIVE_INFINITY) - (b.recentIndex ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(recentDelta) && recentDelta !== 0)
      return recentDelta;
    if ((b.modifiedTime || 0) !== (a.modifiedTime || 0))
      return (b.modifiedTime || 0) - (a.modifiedTime || 0);
    return a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

let jarvisReaderCodeMirrorModules: CodeMirrorModules | null | undefined = void 0;

export function getJarvisReaderCodeMirrorModules(): CodeMirrorModules | null {
  if (jarvisReaderCodeMirrorModules !== void 0)
    return jarvisReaderCodeMirrorModules;
  try {
    const state = require("@codemirror/state");
    const view = require("@codemirror/view");
    const autocomplete = require("@codemirror/autocomplete");
    const commands = require("@codemirror/commands");
    jarvisReaderCodeMirrorModules = { state, view, autocomplete, commands };
  } catch (error) {
    console.warn("Jarvis Reader CodeMirror unavailable; using textarea fallback.", error);
    jarvisReaderCodeMirrorModules = null;
  }
  return jarvisReaderCodeMirrorModules!;
}

export function getWikiLinkRangeInText(value: string, cursor: number): WikiLinkRange | null {
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = pattern.exec(value || "")) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor >= start && cursor <= end) {
      return {
        start,
        end,
        innerStart: start + 2,
        innerEnd: end - 2,
        target: ((match[1] || "").split("|")[0] || "").trim()
      };
    }
  }
  return null;
}

export function createWikiLinkDecorationsExtension(cm: CodeMirrorModules): any {
  const { EditorView: EditorView2, ViewPlugin, Decoration } = cm.view;
  const { RangeSetBuilder } = cm.state;
  const build = (view: any) => {
    const builder = new RangeSetBuilder();
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    const pattern = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = pattern.exec(doc)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const innerStart = start + 2;
      const innerEnd = end - 2;
      const active = head > start && head < end && (head <= innerStart || head >= innerEnd);
      if (active) {
        builder.add(start, innerStart, Decoration.mark({ class: "jarvis-reader-cm-wikilink-bracket" }));
        if (innerEnd > innerStart) {
          builder.add(innerStart, innerEnd, Decoration.mark({ class: "jarvis-reader-cm-wikilink jarvis-reader-cm-wikilink-active" }));
        }
        builder.add(innerEnd, end, Decoration.mark({ class: "jarvis-reader-cm-wikilink-bracket" }));
        continue;
      }
      if (innerStart > start) {
        builder.add(start, innerStart, Decoration.replace({}));
      }
      if (innerEnd > innerStart) {
        builder.add(innerStart, innerEnd, Decoration.mark({ class: "jarvis-reader-cm-wikilink" }));
      }
      if (end > innerEnd) {
        builder.add(innerEnd, end, Decoration.replace({}));
      }
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(class {
    decorations: any;
    constructor(view: any) {
      this.decorations = build(view);
    }
    update(update: any) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  }, {
    decorations: (plugin: any) => plugin.decorations,
    eventHandlers: {
      mousedown(event: MouseEvent, view: any) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null)
          return false;
        const range = getWikiLinkRangeInText(view.state.doc.toString(), pos);
        if (!range || !range.target)
          return false;
        const head = view.state.selection.main.head;
        if (head >= range.start && head <= range.end)
          return false;
        if (pos <= range.innerStart || pos >= range.innerEnd)
          return false;
        const open = (view.dom as any).__jarvisReaderOpenWikiLink;
        if (typeof open === "function") {
          event.preventDefault();
          event.stopPropagation();
          open(range.target);
          return true;
        }
        return false;
      }
    }
  });
}

export const WikiLinkCodeMirrorEditor: React.FC<WikiLinkCodeMirrorEditorProps> = ({ value, onChange, candidates, onOpenLink, placeholder }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);
  const valueRef = useRef<string>(value || "");
  const candidatesRef = useRef<LinkCandidate[]>(candidates || []);
  const openRef = useRef<((target: string) => void) | undefined>(onOpenLink);
  candidatesRef.current = candidates || [];
  openRef.current = onOpenLink;
  useEffect(() => {
    const cm = getJarvisReaderCodeMirrorModules();
    const host = hostRef.current;
    if (!cm || !host)
      return;
    const { EditorState: EditorState2 } = cm.state;
    const { EditorView: EditorView2, keymap } = cm.view;
    const { autocompletion } = cm.autocomplete;
    const { defaultKeymap, history, historyKeymap } = cm.commands;
    const wikiCompletion = autocompletion({
      activateOnTyping: true,
      override: [(context: any) => {
        const before = context.state.sliceDoc(0, context.pos);
        const start = before.lastIndexOf("[[");
        if (start < 0)
          return null;
        const query = before.slice(start + 2);
        if (query.includes("]]") || query.includes("\n"))
          return null;
        const needle = query.trim().toLowerCase();
        const options = (candidatesRef.current || []).map((item: LinkCandidate) => {
          const title = item.title || "";
          const path = item.path || "";
          const titleKey = title.toLowerCase();
          const pathKey = path.toLowerCase();
          let score = 1;
          if (needle) {
            if (titleKey === needle)
              score = 100;
            else if (titleKey.startsWith(needle))
              score = 80;
            else if (titleKey.includes(needle))
              score = 60;
            else if (pathKey.includes(needle))
              score = 40;
            else
              score = 0;
          }
          return {
            label: title,
            detail: path,
            boost: score,
            recentIndex: item.recentIndex,
            modifiedTime: item.modifiedTime,
            render() {
              const wrap = document.createElement("div");
              wrap.className = "jarvis-reader-cm-completion";
              const titleEl = document.createElement("div");
              titleEl.className = "jarvis-reader-cm-completion-title";
              titleEl.textContent = title;
              const pathEl = document.createElement("div");
              pathEl.className = "jarvis-reader-cm-completion-path";
              pathEl.textContent = path;
              wrap.appendChild(titleEl);
              wrap.appendChild(pathEl);
              return wrap;
            },
            apply(view: any, completion: any, from: number, to: number) {
              const insert = `${item.insertText || title}]]`;
              view.dispatch({
                changes: { from, to, insert },
                selection: { anchor: from + insert.length }
              });
            }
          };
    }).filter((item: any) => !needle || item.boost > 0).sort((a: any, b: any) => {
      if ((b.boost || 0) !== (a.boost || 0))
        return (b.boost || 0) - (a.boost || 0);
      const recentDelta = (a.recentIndex ?? Number.POSITIVE_INFINITY) - (b.recentIndex ?? Number.POSITIVE_INFINITY);
      if (recentDelta !== 0)
        return recentDelta;
      if (!needle) {
        const modifiedDelta = (b.modifiedTime || 0) - (a.modifiedTime || 0);
        if (modifiedDelta !== 0)
          return modifiedDelta;
      }
      return a.label.localeCompare(b.label, "zh-Hans-CN");
    }).slice(0, 12);
        if (!options.length)
          return null;
        return { from: start + 2, options };
      }]
    });
    const wrapWikiKeymap = keymap.of([{
      key: "Mod-k",
      run(view: any) {
        const selection = view.state.selection.main;
        const selected = view.state.sliceDoc(selection.from, selection.to);
        const insert = selected ? `[[${selected}]]` : "[[]]";
        const cursor = selected ? selection.from + insert.length : selection.from + 2;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert },
          selection: { anchor: cursor }
        });
        return true;
      }
    }]);
    const updateListener = EditorView2.updateListener.of((update: any) => {
      if (!update.docChanged)
        return;
      const next = update.state.doc.toString();
      valueRef.current = next;
      onChange(next);
    });
    const view = new EditorView2({
      state: EditorState2.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          wrapWikiKeymap,
          wikiCompletion,
          createWikiLinkDecorationsExtension(cm),
          updateListener,
          EditorView2.lineWrapping,
          EditorView2.theme({
            "&": { minHeight: "78px" },
            ".cm-content": {
              fontFamily: "var(--font-interface)",
              fontSize: "var(--font-ui-small)",
              lineHeight: "1.5",
              padding: "10px 11px"
            },
            ".cm-scroller": { fontFamily: "var(--font-interface)" }
          })
        ]
      }),
      parent: host
    });
    (view.dom as any).__jarvisReaderOpenWikiLink = (target: string) => {
      if (typeof openRef.current === "function")
        openRef.current(target);
    };
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);
  useEffect(() => {
    const view = viewRef.current;
    const next = value || "";
    if (!view || next === valueRef.current)
      return;
    valueRef.current = next;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next }
    });
  }, [value]);
  if (!getJarvisReaderCodeMirrorModules()) {
    return React.createElement("textarea", {
      className: "jarvis-reader-highlight-input",
      value: value || "",
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value)
    });
  }
  return React.createElement("div", {
    className: "jarvis-reader-cm-editor",
    ref: hostRef,
    "data-placeholder": placeholder || ""
  });
};
