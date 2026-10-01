export interface OverlayRect { x: number; y: number; width: number; height: number }

/** Fit a card inside the actual reader pane, including panes smaller than its preferred size. */
export function fitReaderOverlay(rect: OverlayRect, bounds: { width: number; height: number }): OverlayRect {
  const margin = Math.min(16, Math.max(0, bounds.width / 4), Math.max(0, bounds.height / 4));
  const width = Math.min(Math.max(0, rect.width), Math.max(0, bounds.width - margin * 2));
  const height = Math.min(Math.max(0, rect.height), Math.max(0, bounds.height - margin * 2));
  return {
    x: Math.max(margin, Math.min(rect.x, bounds.width - width - margin)),
    y: Math.max(margin, Math.min(rect.y, bounds.height - height - margin)),
    width,
    height,
  };
}
