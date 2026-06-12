import { useEffect, useMemo, useRef, useState } from "react";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";
import type { BookProgress } from "../domain/index.ts";
import {
  findChapterTitle,
  getReaderOptions,
  getReaderProgress,
  type EpubTocItem,
  type ProgressRenditionLike,
  type RelocatedLocation,
} from "./core.ts";
import { applyReaderTheme } from "./theme.ts";

export interface JarvisEpubReaderProps {
  contents: ArrayBuffer;
  title: string;
  scrolled: boolean;
  singlePage: boolean;
  readerZoom: number;
  readerLineHeight: number;
  initLocation: string | number | null;
  onLocationChange(location: string | number): void;
  onProgress(progress: BookProgress): void;
  onTocChange(toc: EpubTocItem[]): void;
  onModeChange(mode: { scrolled: boolean; singlePage: boolean }): void;
  onZoomChange(value: number): void;
  onLineHeightChange(value: number): void;
}

export function JarvisEpubReader(props: JarvisEpubReaderProps) {
  const [location, setLocation] = useState<string | number>(props.initLocation || 0);
  const [progressLabel, setProgressLabel] = useState("");
  const renditionRef = useRef<Rendition | null>(null);
  const relocatedHandlerRef = useRef<((relocated: RelocatedLocation) => void) | null>(
    null,
  );
  const tocRef = useRef<EpubTocItem[]>([]);
  const options = useMemo(
    () => getReaderOptions({ scrolled: props.scrolled, singlePage: props.singlePage }),
    [props.scrolled, props.singlePage],
  );

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) applyReaderTheme(rendition, props.readerZoom, props.readerLineHeight);
  }, [props.readerZoom, props.readerLineHeight]);

  useEffect(
    () => () => {
      const rendition = renditionRef.current;
      const handler = relocatedHandlerRef.current;
      if (rendition && handler) rendition.off("relocated", handler as never);
      renditionRef.current = null;
      relocatedHandlerRef.current = null;
    },
    [],
  );

  const bindRendition = (rendition: Rendition): void => {
    const previous = renditionRef.current;
    const previousHandler = relocatedHandlerRef.current;
    if (previous && previousHandler) previous.off("relocated", previousHandler as never);
    renditionRef.current = rendition;
    applyReaderTheme(rendition, props.readerZoom, props.readerLineHeight);
    const handler = (relocated: RelocatedLocation): void => {
      const chapterTitle = findChapterTitle(tocRef.current, relocated.start?.href);
      const progress = getReaderProgress(
        relocated,
        rendition as unknown as ProgressRenditionLike,
        chapterTitle,
      );
      if (progress) {
        setProgressLabel(progress.label);
        props.onProgress(progress);
      }
    };
    relocatedHandlerRef.current = handler;
    rendition.on("relocated", handler as never);
  };

  const changeLocation = (next: string | number): void => {
    setLocation(next);
    props.onLocationChange(next);
  };

  const changeToc = (toc: EpubTocItem[]): void => {
    tocRef.current = toc;
    props.onTocChange(toc);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "6px 10px",
          borderBottom: "1px solid var(--background-modifier-border)",
        }}
      >
        <button
          type="button"
          onClick={() =>
            props.onModeChange({ singlePage: !props.singlePage, scrolled: false })
          }
        >
          {props.singlePage ? "单页" : "双页"}
        </button>
        <button
          type="button"
          disabled={!props.singlePage}
          onClick={() =>
            props.onModeChange({ singlePage: true, scrolled: !props.scrolled })
          }
        >
          {props.scrolled ? "滚动" : "分页"}
        </button>
        <button type="button" onClick={() => props.onZoomChange(-0.05)}>
          字号-
        </button>
        <button type="button" onClick={() => props.onZoomChange(0.05)}>
          字号+
        </button>
        <button type="button" onClick={() => props.onLineHeightChange(-0.05)}>
          行距-
        </button>
        <button type="button" onClick={() => props.onLineHeightChange(0.05)}>
          行距+
        </button>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
          {progressLabel}
        </span>
      </div>
      <div style={{ minHeight: 0, flex: 1, overflow: "hidden" }}>
        <ReactReader
          title={props.title}
          showToc
          location={location}
          locationChanged={changeLocation}
          tocChanged={changeToc as unknown as (toc: never) => void}
          getRendition={bindRendition}
          swipeable={false}
          url={props.contents}
          epubOptions={options}
        />
      </div>
    </div>
  );
}
