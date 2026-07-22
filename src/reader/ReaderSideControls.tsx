import React from "react";

interface ReaderSideControlsProps {
  location: string | null;
  chapterTitle: string;
  singlePage: boolean;
  scrolled: boolean;
  onAddBookmark?: (cfi: string, title: string) => void;
  onOpenBookNote: () => void;
  onZoom: (delta: number) => void;
  onLineHeight: (delta: number) => void;
  onScrolledChange: (value: boolean) => void;
  onSinglePageChange: (value: boolean) => void;
}

const ICONS = {
  bookmark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>',
  zoomIn: '<svg viewBox="0 0 24 24"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
  zoomOut: '<svg viewBox="0 0 24 24"><path d="M5 12h14"></path></svg>',
  lineTight: '<svg viewBox="0 0 24 24"><path d="M8 6h8"></path><path d="M8 12h8"></path><path d="M8 18h8"></path><path d="M4 9l2-2 2 2"></path><path d="M4 15l2 2 2-2"></path></svg>',
  lineLoose: '<svg viewBox="0 0 24 24"><path d="M8 6h8"></path><path d="M8 12h8"></path><path d="M8 18h8"></path><path d="M4 6l2-2 2 2"></path><path d="M4 18l2 2 2-2"></path></svg>',
  paged: '<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"></path></svg>',
  scroll: '<svg viewBox="0 0 24 24"><path d="M8 3 4 7l4 4"></path><path d="M4 7h10a6 6 0 0 1 0 12H6"></path></svg>',
  dual: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1"></rect><rect x="13" y="5" width="8" height="14" rx="1"></rect></svg>',
  single: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="2"></rect></svg>',
} as const;

function IconButton({ label, icon, className = "", onClick }: { label: string; icon: string; className?: string; onClick: () => void }) {
  return <button className={`jarvis-reader-side-button ${className}`.trim()} title={label} aria-label={label} onClick={onClick} dangerouslySetInnerHTML={{ __html: icon }} />;
}

export function ReaderSideControls(props: ReaderSideControlsProps) {
  const {
    location, chapterTitle, singlePage, scrolled, onAddBookmark, onOpenBookNote,
    onZoom, onLineHeight, onScrolledChange, onSinglePageChange,
  } = props;
  return (
    <div className="jarvis-reader-side-hover-zone">
      <div className="jarvis-reader-side-controls">
        <IconButton label="添加书签" icon={ICONS.bookmark} onClick={() => location && chapterTitle && onAddBookmark?.(location, chapterTitle)} />
        <IconButton label="创建或打开笔记文件" icon={ICONS.note} onClick={onOpenBookNote} />
        <IconButton label="放大" icon={ICONS.zoomIn} onClick={() => onZoom(0.05)} />
        <IconButton label="缩小" icon={ICONS.zoomOut} onClick={() => onZoom(-0.05)} />
        <IconButton label="减小行距" icon={ICONS.lineTight} onClick={() => onLineHeight(-0.05)} />
        <IconButton label="增大行距" icon={ICONS.lineLoose} onClick={() => onLineHeight(0.05)} />
        {singlePage && <IconButton className="jarvis-reader-side-mode-button" label={scrolled ? "切换到分页" : "切换到滚动"} icon={scrolled ? ICONS.paged : ICONS.scroll} onClick={() => onScrolledChange(!scrolled)} />}
        <IconButton className="jarvis-reader-side-mode-button" label={singlePage ? "切换到双页" : "切换到单页"} icon={singlePage ? ICONS.dual : ICONS.single} onClick={() => onSinglePageChange(!singlePage)} />
      </div>
    </div>
  );
}
