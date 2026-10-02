interface AnnotationStore {
  remove(cfi: string, type: string): void;
  _annotations: Record<string, unknown>;
  _annotationsBySectionIndex: Record<string, string[]>;
}

/** epub.js 0.3 私有接口适配：无视图时 remove 遗留章节索引，升级引擎时需复核。 */
export function removeEpubAnnotation(store: AnnotationStore, cfi: string, type: string): void {
  store.remove(cfi, type);
  // 同时清除此前操作留下的无效编号，并去掉重复编号。
  for (const section of Object.keys(store._annotationsBySectionIndex)) {
    store._annotationsBySectionIndex[section] = [...new Set(
      store._annotationsBySectionIndex[section].filter((key) => Object.hasOwn(store._annotations, key)),
    )];
  }
}


interface HighlightPaneRendition {
  manager?: {
    stage?: unknown;
    visible?: () => Array<{ pane?: { render?: () => void } } | null> | null;
  };
}

/** epub.js 0.3 私有 pane 适配；延时和下一帧顺序保持，升级引擎时需复核。 */
export function refreshHighlightPanes(value: unknown): void {
  // 官方Rendition类型不声明manager／pane私有字段；入口隔离该引擎边界。
  const rendition = value as HighlightPaneRendition | null | undefined;
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      try {
        if (!rendition || !rendition.manager || !rendition.manager.stage) return;
        const views = (typeof rendition.manager.visible === "function" ? rendition.manager.visible() : null) || [];
        for (const view of views) {
          if (view && view.pane && typeof view.pane.render === "function") {
            view.pane.render();
          }
        }
      } catch (error) {
        console.warn("Jarvis Reader highlight refresh failed.", error);
      }
    });
  }, 80);
}
