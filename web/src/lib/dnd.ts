// HTML5 drag-and-drop can't read dataTransfer contents during dragover, so the
// current internal drag payload is kept here.

export type DragPayload = { type: 'bookmarks'; ids: number[] } | { type: 'collection'; id: number };

let current: DragPayload | null = null;

export const dnd = {
  start(e: React.DragEvent, payload: DragPayload) {
    current = payload;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-magpie', JSON.stringify(payload));
  },
  end() {
    current = null;
  },
  get: () => current,
};

/** Where the pointer is relative to an element: before / inside / after. */
export function dropZone(e: React.DragEvent, el: HTMLElement, allowInside: boolean, axis: 'y' | 'x' = 'y') {
  const rect = el.getBoundingClientRect();
  const ratio = axis === 'y' ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
  if (!allowInside) return ratio < 0.5 ? 'before' : 'after';
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}
