import { getIcon } from "obsidian";
import React, { useCallback, useRef, useState, useId, useEffect } from "react";
import { createPortal } from "react-dom";
import { ReaderSettingsPanel, type ReaderSettingsAccess } from "./ReaderSettingsPanel";

interface ReaderSideControlsProps extends ReaderSettingsAccess {
  location: string | null;
  chapterTitle: string;
  onAddBookmark?: (cfi: string, title: string) => void;
  onOpenBookNote: () => void;
}

function IconButton({ label, icon, className = "", disabled = false, onClick }: { label: string; icon: string; className?: string; disabled?: boolean; onClick: () => void }) {
  return <button className={`clickable-icon view-action jarvis-reader-side-button ${className}`.trim()} aria-label={label} disabled={disabled} onClick={onClick} dangerouslySetInnerHTML={{ __html: icon }} />;
}

export function ReaderSideControls(props: ReaderSideControlsProps) {
  const [open, setOpen] = useState(props.getPanelOpen);
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
  const [headerTitle, setHeaderTitle] = useState<HTMLElement | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const leaf = zoneRef.current?.closest(".workspace-leaf-content");
    const actions = leaf?.querySelector<HTMLElement>(".view-header .view-actions");
    if (actions) setHeaderActions(actions);
    const title = leaf?.querySelector<HTMLElement>(".view-header .view-header-title-container");
    if (title) setHeaderTitle(title);
  }, []);
  useEffect(() => {
    const zone = zoneRef.current;
    const reader = zone?.closest<HTMLElement>(".jarvis-reader-epub");
    if (!zone || !reader) return;
    const previousHeight = reader.style.getPropertyValue("--jarvis-reader-height");
    const resize = new ResizeObserver(() => {
      reader.style.setProperty("--jarvis-reader-height", `${reader.clientHeight}px`);
    });
    resize.observe(reader);
    return () => {
      resize.disconnect();
      if (previousHeight) reader.style.setProperty("--jarvis-reader-height", previousHeight);
      else reader.style.removeProperty("--jarvis-reader-height");
    };
  }, []);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => { setOpen(false); props.onPanelOpenChange(false); buttonRef.current?.focus(); }, [props.onPanelOpenChange]);
  const {
    location, chapterTitle, onAddBookmark, onOpenBookNote,
  } = props;
  const controls = (
    <div className="jarvis-reader-side-controls" role="group" aria-label="阅读工具">
      <IconButton label="添加书签" disabled={!location || !chapterTitle || !onAddBookmark} icon={getIcon("bookmark")?.outerHTML || ""} onClick={() => location && chapterTitle && onAddBookmark?.(location, chapterTitle)} />
      <IconButton label="打开本书笔记" icon={getIcon("file-text")?.outerHTML || ""} onClick={onOpenBookNote} />
      <button ref={buttonRef} className="clickable-icon view-action jarvis-reader-side-button jarvis-reader-settings-button" aria-label="阅读设置" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(!open); props.onPanelOpenChange(!open); }} dangerouslySetInnerHTML={{ __html: getIcon("settings")?.outerHTML || "" }} />
    </div>
  );
  return (
    <div ref={zoneRef} className={`jarvis-reader-side-hover-zone${open ? " is-open" : ""}`} onClick={e => e.stopPropagation()}>
      {headerTitle && createPortal(<div className="jarvis-reader-reading-title" title={chapterTitle}>{chapterTitle}</div>, headerTitle)}
      {headerActions ? createPortal(controls, headerActions) : controls}
      {open && <ReaderSettingsPanel id={panelId} getPreferences={props.getPreferences} onPreferencesChange={props.onPreferencesChange} onClose={close} getPanelOpen={props.getPanelOpen} onPanelOpenChange={props.onPanelOpenChange} />}
    </div>
  );
}
