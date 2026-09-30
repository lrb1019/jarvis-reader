export type SelectionTranslationKind = "offline" | "ai";

export function getSelectionTranslationOptions(kind: SelectionTranslationKind): { localOnly: true } | { forceAi: true } {
  return kind === "offline" ? { localOnly: true } : { forceAi: true };
}

export function clampSelectionMenuPosition(x: number, y: number, width: number, height: number, boundsWidth: number, boundsHeight: number): { left: number; top: number } {
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(x, boundsWidth - width - margin)),
    top: Math.max(margin, Math.min(y, boundsHeight - height - margin)),
  };
}
