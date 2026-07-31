export interface FloatingCardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

export function moveFloatingCardRect(
  startRect: FloatingCardRect,
  startPointer: PointerPosition,
  currentPointer: PointerPosition,
): FloatingCardRect {
  return {
    ...startRect,
    x: startRect.x + currentPointer.x - startPointer.x,
    y: startRect.y + currentPointer.y - startPointer.y,
  };
}
