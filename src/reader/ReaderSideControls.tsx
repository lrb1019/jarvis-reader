import { getIcon } from "obsidian";
import React, { useCallback, useRef, useState, useId, useEffect } from "react";
import { ReaderSettingsPanel, type ReaderSettingsAccess } from "./ReaderSettingsPanel";

interface ReaderSideControlsProps extends ReaderSettingsAccess {
  location: string | null;
  chapterTitle: string;
  onAddBookmark?: (cfi: string, title: string) => void;
  onOpenBookNote: () => void;
}

function IconButton({ label, icon, className = "", disabled = false, onClick }: { label: string; icon: string; className?: string; disabled?: boolean; onClick: () => void }) {
  return <button className={`jarvis-reader-side-button ${className}`.trim()} aria-label={label} disabled={disabled} onClick={onClick} dangerouslySetInnerHTML={{ __html: icon }} />;
}

export function ReaderSideControls(props: ReaderSideControlsProps) {
  const [open, setOpen] = useState(props.getPanelOpen);
  const [active, setActive] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const reveal = useCallback(() => {
    setActive(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setActive(false), 2500);
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
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => { setOpen(false); props.onPanelOpenChange(false); buttonRef.current?.focus(); }, [props.onPanelOpenChange]);
  const {
    location, chapterTitle, onAddBookmark, onOpenBookNote,
  } = props;
  return (
    <div ref={zoneRef} className={`jarvis-reader-side-hover-zone${open ? " is-open" : ""}${active ? " is-active" : ""}`} onPointerEnter={reveal} onPointerMove={reveal} onPointerDown={reveal} onClick={e => e.stopPropagation()}>
      <div className="jarvis-reader-side-controls">
        {<IconButton label="添加书签" disabled={!location || !chapterTitle || !onAddBookmark} icon={getIcon("bookmark")?.outerHTML || ""} onClick={() => location && chapterTitle && onAddBookmark?.(location, chapterTitle)} />}
        {<IconButton label="打开本书笔记" icon={getIcon("file-text")?.outerHTML || ""} onClick={onOpenBookNote} />}
        <button ref={buttonRef} className="jarvis-reader-side-button jarvis-reader-settings-button" aria-label="阅读设置" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(!open); props.onPanelOpenChange(!open); }} dangerouslySetInnerHTML={{ __html: getIcon("settings")?.outerHTML || "" }} />
      </div>
      {open && <ReaderSettingsPanel id={panelId} getPreferences={props.getPreferences} onPreferencesChange={props.onPreferencesChange} onClose={close} getPanelOpen={props.getPanelOpen} onPanelOpenChange={props.onPanelOpenChange} />}
    </div>
  );
}
