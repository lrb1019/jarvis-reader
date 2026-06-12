import type { BookHighlight } from "../domain/index.ts";
import { HIGHLIGHT_COLOR_STYLES, normalizeHighlightColor } from "../core/highlights.ts";

interface AnnotationApi {
  highlight(
    cfiRange: string,
    data: unknown,
    callback: (event: MouseEvent) => void,
    className: string,
    styles: Record<string, string>,
  ): unknown;
  remove(cfiRange: string, type: "highlight"): void;
}

export interface HighlightRenditionLike {
  annotations?: AnnotationApi;
  display(target: string): Promise<unknown> | unknown;
  manager?: { visible?: () => Array<{ pane?: { render?: () => void } }> };
}

const renderedHighlights = new WeakMap<object, Map<string, string>>();

function refreshPanes(rendition: HighlightRenditionLike): void {
  globalThis.setTimeout(() => {
    for (const view of rendition.manager?.visible?.() || []) view.pane?.render?.();
  }, 0);
}

export function removeRenderedHighlight(
  rendition: HighlightRenditionLike,
  highlight: BookHighlight,
): void {
  rendition.annotations?.remove(highlight.cfiRange, "highlight");
  renderedHighlights.get(rendition as object)?.delete(highlight.id);
  refreshPanes(rendition);
}

export function renderHighlight(
  rendition: HighlightRenditionLike,
  highlight: BookHighlight,
  onClick: (highlight: BookHighlight, event: MouseEvent) => void,
): void {
  if (!rendition.annotations || !highlight.cfiRange) return;
  let rendered = renderedHighlights.get(rendition as object);
  if (!rendered) {
    rendered = new Map();
    renderedHighlights.set(rendition as object, rendered);
  }
  const color = normalizeHighlightColor(highlight.markColor);
  const signature = `${highlight.cfiRange}:${color}:${highlight.updated || highlight.created}`;
  if (rendered.get(highlight.id) === signature) return;
  if (rendered.has(highlight.id)) rendition.annotations.remove(highlight.cfiRange, "highlight");
  const palette = HIGHLIGHT_COLOR_STYLES[color];
  rendition.annotations.highlight(
    highlight.cfiRange,
    { id: highlight.id },
    (event) => onClick(highlight, event),
    `jarvis-reader-highlight jarvis-reader-highlight-${color}`,
    {
      fill: palette.fill,
      "fill-opacity": highlight.comment ? "0.42" : "0.56",
      stroke: palette.stroke,
      "stroke-width": highlight.comment ? "1.4" : "0.7",
      "stroke-opacity": "0.9",
    },
  );
  rendered.set(highlight.id, signature);
  refreshPanes(rendition);
}

export function renderHighlights(
  rendition: HighlightRenditionLike,
  highlights: readonly BookHighlight[],
  onClick: (highlight: BookHighlight, event: MouseEvent) => void,
): void {
  for (const highlight of highlights) renderHighlight(rendition, highlight, onClick);
}
