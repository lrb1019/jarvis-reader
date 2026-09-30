import { getIcon } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { DEFAULT_READER_PREFERENCES, READER_LETTER_SPACING_LIMITS, READER_WORD_SPACING_LIMITS, READER_ZOOM_LIMITS, READER_LINE_HEIGHT_LIMITS, READER_WIDTH_LIMITS, type ReaderNumberLimits, type ReaderPreferences } from "../reader-settings";

export interface ReaderSettingsAccess {
  getPanelOpen: () => boolean;
  onPanelOpenChange: (open: boolean) => void;
  getPreferences: () => ReaderPreferences;
  onPreferencesChange: (patch: Partial<ReaderPreferences>) => Promise<void>;
}

function RangeSetting({ label, value, limits, busy, change, format, icon }: { icon: string; label: string; value: number; limits: ReaderNumberLimits; busy: boolean; change: (value: number) => void; format: (value: number) => string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label className="jarvis-reader-settings-range"><span className="jarvis-reader-settings-range-label">{label}</span><span className="jarvis-reader-settings-range-control"><span aria-hidden="true" className="jarvis-reader-settings-range-icon" dangerouslySetInnerHTML={{ __html: getIcon(icon)?.outerHTML || "" }} /><input aria-label={label} type="range" min={limits.min} max={limits.max} step={limits.step} value={draft} aria-busy={busy}
    onChange={e => setDraft(Number(e.currentTarget.value))}
    onPointerUp={e => change(Number(e.currentTarget.value))}
    onKeyUp={e => { if (e.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(e.key)) change(Number(e.currentTarget.value)); }} /><output>{format(draft)}</output></span></label>;
}

function IconChoice({ label, value, options, disabled, change }: {
  label: string; value: string; options: ReadonlyArray<{ value: string; label: string; icon: string }>;
  disabled: boolean; change: (value: string) => void;
}) {
  return <div className="jarvis-reader-settings-choice" role="group" aria-label={label}>
    <span>{label}</span><div className="jarvis-reader-settings-icon-options">
      {options.map(option => <button key={option.value} type="button" aria-label={option.label} title={option.label}
        aria-pressed={value === option.value} disabled={disabled} onClick={() => change(option.value)}
        dangerouslySetInnerHTML={{ __html: getIcon(option.icon)?.outerHTML || "" }} />)}
    </div>
  </div>;
}

export function ReaderSettingsPanel({ getPreferences, onPreferencesChange, onClose, id }: ReaderSettingsAccess & { onClose: () => void; id: string }) {
  const [values, setValues] = useState(getPreferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!panelRef.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("pointerdown", outside);
    panelRef.current?.addEventListener("keydown", key);
    const wheel = (event: WheelEvent) => event.stopPropagation();
    panelRef.current?.addEventListener("wheel", wheel);
    const panel = panelRef.current;
    const iframeDocuments = new Set<Document>();
    const sync = () => {
      setValues(getPreferences());
      panel?.closest(".jarvis-reader-epub")?.querySelectorAll("iframe").forEach(frame => {
        const doc = frame.contentDocument;
        if (doc && !iframeDocuments.has(doc)) { doc.addEventListener("pointerdown", onClose); iframeDocuments.add(doc); }
      });
    };
    sync();
    const timer = window.setInterval(sync, 300);
    return () => { document.removeEventListener("pointerdown", outside); panel?.removeEventListener("keydown", key); panel?.removeEventListener("wheel", wheel); window.clearInterval(timer); iframeDocuments.forEach(doc => doc.removeEventListener("pointerdown", onClose)); };
  }, [getPreferences, onClose]);
  const change = async (patch: Partial<ReaderPreferences>) => {
    setBusy(true); setError("");
    try { await onPreferencesChange(patch); setValues(getPreferences()); }
    catch { setError("阅读设置保存失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <div ref={panelRef} id={id} role="dialog" aria-label="阅读设置" aria-busy={busy} className="jarvis-reader-settings-panel"
    onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header><strong>阅读设置</strong><button aria-label="关闭阅读设置" onClick={onClose}>×</button></header>
    <fieldset className="jarvis-reader-settings-group"><legend>文字排版</legend><div className="jarvis-reader-settings-group-body">
      <RangeSetting icon="type" label="字号" value={values.readerZoom} limits={READER_ZOOM_LIMITS} busy={busy} format={value => `${Math.round(value * 100)}%`} change={value => void change({ readerZoom: value })} />
      <RangeSetting icon="list" label="行距" value={values.readerLineHeight} limits={READER_LINE_HEIGHT_LIMITS} busy={busy} format={value => value.toFixed(2)} change={value => void change({ readerLineHeight: value })} />
      <RangeSetting icon="move-horizontal" label="字符间距" value={values.readerLetterSpacing} limits={READER_LETTER_SPACING_LIMITS} busy={busy} format={value => `${value > 0 ? "+" : ""}${value}%`} change={value => void change({ readerLetterSpacing: value })} />
      <RangeSetting icon="space" label="词间距" value={values.readerWordSpacing} limits={READER_WORD_SPACING_LIMITS} busy={busy} format={value => `${value > 0 ? "+" : ""}${value}%`} change={value => void change({ readerWordSpacing: value })} />
      <IconChoice label="首行缩进" value={values.readerParagraphIndent} disabled={busy} options={[
        { value: "original", label: "遵循原书缩进", icon: "book-open" },
        { value: "two-chars", label: "首行缩进两字", icon: "indent-increase" },
        { value: "none", label: "不缩进", icon: "align-left" },
      ]} change={value => void change({ readerParagraphIndent: value as ReaderPreferences["readerParagraphIndent"] })} />
    </div></fieldset>
    <fieldset className="jarvis-reader-settings-group"><legend>阅读布局</legend><div className="jarvis-reader-settings-group-body">
      <RangeSetting icon="panel-top" label="正文宽度" value={values.readerWidth} limits={READER_WIDTH_LIMITS} busy={busy} format={value => `${value}px`} change={value => void change({ readerWidth: value })} />
      <IconChoice label="栏数" value={values.singlePageView ? "single" : "dual"} disabled={busy} options={[
        { value: "single", label: "1 栏", icon: "square" },
        { value: "dual", label: "2 栏", icon: "columns-2" },
      ]} change={value => void change({ singlePageView: value === "single" })} />
      <IconChoice label="阅读方式" value={values.scrolledView ? "scroll" : "paged"} disabled={busy || !values.singlePageView} options={[
        { value: "paged", label: "分页阅读", icon: "book-open" },
        { value: "scroll", label: "滚动阅读", icon: "scroll-text" },
      ]} change={value => void change({ scrolledView: value === "scroll" })} />
    </div></fieldset>
    <button className="jarvis-reader-settings-reset" disabled={busy} title="只恢复阅读排版与模式，保留阅读进度、书签和笔记。" onClick={() => void change({ ...DEFAULT_READER_PREFERENCES })}>恢复阅读默认值</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
