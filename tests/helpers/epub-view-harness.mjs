import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const projectRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(`${projectRoot}/package.json`);
const ts = require("typescript");
const sourcePath = `${projectRoot}/src/EpubView.ts`;
const source = fs.readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const epubView = sourceFile.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "EpubView");
if (!epubView) throw new Error("EpubView class was not found");
const methodText = (name) => {
  const method = epubView.members.find((node) => ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === name);
  if (!method) throw new Error(`${name} was not found`);
  return method.getText(sourceFile);
};
const fields = epubView.members.filter(node => ts.isPropertyDeclaration(node)).map(node => node.getText(sourceFile)).join("\n");
const extracted = `class ExtractedEpubView {\n${fields}\n${methodText("onLoadFile")}\n${methodText("onunload")}\n${methodText("prepareBookPathChange")}\n${methodText("startThemeSync")}\n}`;
const transpiled = ts.transpileModule(extracted, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
const errors = (transpiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(ts.formatDiagnostics(errors, {
  getCurrentDirectory: () => projectRoot,
  getCanonicalFileName: (fileName) => fileName,
  getNewLine: () => "\n",
}));

let activeHarness = null;
const ReactStub = {
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
};
const makeViewClass = new Function(
  "createRoot", "React", "EpubReader", "clampReaderWidth", "clampReaderZoom",
  "clampReaderLineHeight", "getMarkdownLinkCandidates", "getComputedStyle", "ReadingStatsService", "window",
  `${transpiled.outputText}\nreturn ExtractedEpubView;`,
);
const ExtractedEpubView = makeViewClass(
  (container) => {
    const h = activeHarness;
    const id = ++h.rootNumber;
    const root = {
      id,
      unmounted: false,
      render(element) {
        h.events.push({ type: "render", id, bookPath: element.props.bookPath, afterUnload: h.unloaded });
        root.props = element.props;
      },
      unmount() {
        this.unmounted = true;
        h.events.push({ type: "unmount", id, afterUnload: h.unloaded });
      },
    };
    h.roots.push(root);
    h.events.push({ type: "createRoot", id, containerMatches: container === h.contentEl, afterUnload: h.unloaded });
    return root;
  },
  ReactStub,
  function EpubReader() {},
  (value) => value,
  (value) => value,
  (value) => value,
  () => [],
  () => ({ width: "800px", height: "600px" }),
  class { async flush() {} },
  { setInterval: () => 1, clearInterval() {}, visualViewport: null },
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeHarness(paths) {
  const h = { events: [], roots: [], rootNumber: 0, unloaded: false, reads: new Map() };
  for (const path of paths) {
    h.reads.set(path, { gate: deferred(), started: deferred() });
  }
  let activeReader = null;
  const plugin = {
    sourceJumpPaths: new Set(),
    settings: {
      readerWidth: 720, readerZoom: 100, readerLineHeight: 1.6,
      singlePageView: false, scrolledView: false, bookInitLocations: {},
      speechLang: "en-US", highlightColors: {}, enableWordAudio: false,
      wordAudioTemplate: "", wordAudioAccent: "", blurWordCardBody: false,
    },
    get activeReaderView() { return activeReader; },
    set activeReaderView(value) {
      activeReader = value;
      h.events.push({ type: "activeReader:set", value: value ? "view" : null, afterUnload: h.unloaded });
    },
    async setActiveReader(view) { this.activeReaderView = view; },
    clearActiveReader(view) {
      if (view && this.activeReaderView !== view) return;
      this.activeReaderView = null;
    },
  };
  h.plugin = plugin;
  h.contentEl = {
    empty() { h.events.push({ type: "empty", afterUnload: h.unloaded }); },
    addEventListener() {},
    removeEventListener() {},
  };
  h.view = Object.assign(new ExtractedEpubView(), {
    app: { vault: { adapter: { readBinary(path) {
      const entry = h.reads.get(path);
      if (!entry) throw new Error(`Unexpected readBinary path: ${path}`);
      h.events.push({ type: "readBinary:start", path });
      entry.started.resolve();
      return entry.gate.promise;
    } } } },
    plugin,
    settings: plugin.settings,
    file: null,
    containerEl: { parentElement: { querySelector: () => ({}) } },
    contentEl: h.contentEl,
    reactRoot: null,
    currentRendition: null,
    themeSyncInterval: null,
    themeSyncViewportHandler: null,
    interactionCleanup: null,
    setHeaderMenuVisibility(value) { h.events.push({ type: "header", visible: value, afterUnload: h.unloaded }); },
    stopThemeSync() { return h.stopGate?.promise || Promise.resolve(); },
    getInitLocation: async () => h.initGate ? await h.initGate.promise : null,
    getBookHighlightsForReader: async () => h.highlightGate ? await h.highlightGate.promise : [],
    getWordAssets: () => ({}),
    shouldAutoHighlightWords: () => true,
    setReaderZoom() {},
    setReaderSettingsOpen() {},
    getReaderSettingsOpen: () => false,
    getReaderPreferences: () => ({}),
    updateReaderPreferences() {},
    createBookNote() {},
    createHighlight() {},
    updateHighlight() {},
    deleteHighlight() {},
    selectHighlight() {},
    registerHighlightEditor(value) { this.highlightEditor = value; },
    registerHighlightDeleted(value) { this.highlightDeleted = value; },
    setInitLocation() { h.events.push({type:"saveLocation"}); },
    setBookProgress() { h.events.push({type:"saveProgress"}); },
    translateSelection() {},
    saveWordAsset() {},
    addBookmark() {},
    deleteWordAsset() {},
    loadWordDisplay() {},
    openWikiLink() {},
    promoteHighlight() {},
    reportBackgroundSaveError() {},
  });
  activeHarness = h;
  return h;
}

function file(path) {
  return { path, basename: path.split("/").at(-1).replace(/\.epub$/i, "") };
}


export { makeHarness, file, deferred };
