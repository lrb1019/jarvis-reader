import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness as make, file, deferred } from "./helpers/epub-view-harness.mjs";

type TestFile = { path: string; basename: string };
type Gate<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
type ReaderProps = {
  saveLocation(location: string): void;
  saveProgress(location: unknown, chapter: string, rendition: unknown): void;
  tocMemo(toc: unknown): void;
  syncRenditionTheme(rendition: unknown): void;
  registerHighlightEditor(editor: unknown): void;
  registerHighlightDeleted(callback: unknown): void;
};
type TestRoot = { id: number; unmounted: boolean; props: ReaderProps };
interface Harness {
  view: { file: TestFile | null; reactRoot: TestRoot | null; currentRendition: unknown;
    highlightEditor: unknown; highlightDeleted: unknown;
    onLoadFile(file: TestFile): Promise<void>; onunload(): void; prepareBookPathChange(path: string): Promise<void>;
    startThemeSync(rendition: unknown, isCurrent?: () => boolean): void };
  reads: Map<string, { gate: Gate<ArrayBuffer>; started: Gate<void> }>;
  roots: TestRoot[];
  events: Array<{ type: string; afterUnload?: boolean; bookPath?: string }>;
  unloaded: boolean;
  plugin: { activeReaderView: unknown };
  initGate?: Gate<string | null>;
  highlightGate?: Gate<unknown[]>;
  stopGate?: Gate<void>;
}
const makeHarness = make as (paths: string[]) => Harness;
function load(h: Harness, path: string) {
  const f = file(path) as TestFile;
  h.view.file = f;
  return h.view.onLoadFile(f);
}
async function releaseRead(h: Harness, path: string) {
  await h.reads.get(path)!.started.promise;
  h.reads.get(path)!.gate.resolve(new ArrayBuffer(8));
}
function close(h: Harness) { h.unloaded = true; h.view.onunload(); }

for (const closeAfterNew of [false, true]) {
  test(`older read cannot overwrite a newer ${closeAfterNew ? "closed" : "open"} reader`, async () => {
    const h = makeHarness(["old.epub", "new.epub"]);
    const oldLoad = load(h, "old.epub");
    await h.reads.get("old.epub")!.started.promise;
    const newLoad = load(h, "new.epub");
    await releaseRead(h, "new.epub"); await newLoad;
    const latest = h.view.reactRoot;
    if (closeAfterNew) close(h);
    await releaseRead(h, "old.epub"); await oldLoad;
    assert.equal(h.roots.length, 1);
    assert.equal(h.view.reactRoot, closeAfterNew ? null : latest);
    assert.equal(latest!.unmounted, closeAfterNew);
    assert.equal(h.plugin.activeReaderView, closeAfterNew ? null : h.view);
    assert.deepEqual(h.events.filter(e => e.type === "render").map(e => e.bookPath), ["new.epub"]);
  });
}

test("closing during binary read leaves no root or active reader", async () => {
  const h = makeHarness(["a.epub"]), pending = load(h, "a.epub");
  await h.reads.get("a.epub")!.started.promise; close(h);
  await releaseRead(h, "a.epub"); await pending;
  assert.equal(h.roots.length, 0);
  assert.equal(h.plugin.activeReaderView, null);
  assert.ok(!h.events.some(e => e.type === "render" && e.afterUnload));
});

for (const phase of ["initGate", "highlightGate"] as const) {
  test(`closing during ${phase} prevents root creation`, async () => {
    const h = makeHarness(["a.epub"]);
    const gate = deferred() as Gate<never>;
    h[phase] = gate;
    const pending = load(h, "a.epub"); await releaseRead(h, "a.epub");
    // Drain the continuation through the immediately resolved host methods.
    await new Promise<void>(resolve => setImmediate(resolve));
    close(h); gate.resolve((phase === "initGate" ? null : []) as never); await pending;
    assert.equal(h.roots.length, 0);
    assert.equal(h.plugin.activeReaderView, null);
  });
}

test("a superseded cleanup completion does not unmount the current root", async () => {
  const h = makeHarness(["old.epub", "new.epub"]);
  const gate = deferred() as Gate<void>; h.stopGate = gate;
  const old = load(h, "old.epub");
  h.stopGate = undefined;
  const current = load(h, "new.epub"); await releaseRead(h, "new.epub"); await current;
  const latest = h.view.reactRoot;
  gate.resolve();
  // Old code continues into readBinary; release it so the regression fails, rather than hangs.
  h.reads.get("old.epub")!.gate.resolve(new ArrayBuffer(8)); await old;
  assert.equal(h.roots.length, 1);
  assert.equal(h.view.reactRoot, latest);
  assert.equal(latest!.unmounted, false);
});

test("book-path preparation invalidates a pending load", async () => {
  const h = makeHarness(["old.epub"]), pending = load(h, "old.epub");
  await h.reads.get("old.epub")!.started.promise;
  await h.view.prepareBookPathChange("old.epub");
  await releaseRead(h, "old.epub"); await pending;
  assert.equal(h.roots.length, 0);
});

test("retired reader callbacks cannot save state or restart theme sync", async () => {
  const h = makeHarness(["old.epub", "new.epub"]);
  const old = load(h, "old.epub"); await releaseRead(h, "old.epub"); await old;
  const props = h.roots[0]!.props;
  const current = load(h, "new.epub"); await releaseRead(h, "new.epub"); await current;
  const before = h.events.length;
  props.saveLocation("old-cfi"); props.saveProgress({}, "old", {}); props.tocMemo([]); props.syncRenditionTheme({});
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(h.events.slice(before), []);
  assert.equal(h.view.currentRendition, null);
});

test("theme synchronization awaiting cleanup cannot resume after unload", async () => {
  const h = makeHarness([]), gate = deferred() as Gate<void>; h.stopGate = gate;
  h.view.startThemeSync({}); close(h); gate.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.view.currentRendition, null);
});

test("a failed read is reported and a subsequent load still renders", async () => {
  const h = makeHarness(["bad.epub", "ok.epub"]);
  const bad = load(h, "bad.epub"), failure = assert.rejects(bad, /read failed/);
  await h.reads.get("bad.epub")!.started.promise;
  h.reads.get("bad.epub")!.gate.reject(new Error("read failed")); await failure;
  const good = load(h, "ok.epub"); await releaseRead(h, "ok.epub"); await good;
  assert.equal(h.roots.length, 1);
  assert.equal(h.plugin.activeReaderView, h.view);
});


test("retired registration cleanup cannot retain or clear the newer handlers", async () => {
  const h = makeHarness(["old.epub", "new.epub"]);
  const old = load(h, "old.epub"); await releaseRead(h, "old.epub"); await old;
  const oldProps = h.roots[0]!.props;
  const oldHandler = () => {};
  oldProps.registerHighlightEditor(oldHandler); oldProps.registerHighlightDeleted(oldHandler);
  assert.equal(h.view.highlightEditor, oldHandler);
  const current = load(h, "new.epub");
  assert.equal(h.view.highlightEditor, null); assert.equal(h.view.highlightDeleted, null);
  await releaseRead(h, "new.epub"); await current;
  const newHandler = () => {};
  h.roots[1]!.props.registerHighlightEditor(newHandler); h.roots[1]!.props.registerHighlightDeleted(newHandler);
  oldProps.registerHighlightEditor(null); oldProps.registerHighlightDeleted(null);
  assert.equal(h.view.highlightEditor, newHandler); assert.equal(h.view.highlightDeleted, newHandler);
  close(h);
  assert.equal(h.view.highlightEditor, null); assert.equal(h.view.highlightDeleted, null);
});
