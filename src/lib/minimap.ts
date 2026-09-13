/**
 * Layout maths for the session question-minimap — the quick-jump ticks beside
 * the chat transcript.
 *
 * The rail is a compact block of evenly spaced ticks (one per question) rather
 * than ticks spread across the full viewport height: centring a handful of ticks
 * with `space-evenly` used to fan three questions out over ~900px.
 *
 * Two constraints shape the result:
 * - Spacing is capped at `MAX_TICK_PITCH` so short sessions stay a tight block.
 * - Spacing never drops below `MIN_TICK_PITCH`, the smallest gap at which two
 *   ticks remain visually distinct (at 2px pitch the 2px-tall bars merge into a
 *   solid bar). When a session has more questions than fit at that pitch, the
 *   rail samples evenly spaced ticks instead of rendering an unreadable smear.
 */
export const MIN_TICK_PITCH = 4;
export const MAX_TICK_PITCH = 10;

/** Fallback rail height used before layout is measured (and in tests). */
export const DEFAULT_MINIMAP_HEIGHT_PX = 320;

/** Vertical padding of the rail, excluded from the usable tick space. */
export const MINIMAP_PADDING_PX = 20;

export interface MinimapLayout {
  /** Centre-to-centre spacing between adjacent ticks, in CSS px. */
  pitch: number;
  /**
   * Indices into the question list to render, ascending. This is every question
   * unless the session is long enough to require sampling.
   */
  indices: number[];
}

/**
 * Choose the tick pitch and which questions to render.
 *
 * `availableHeight` is the height the rail may occupy. Every question is
 * rendered while the ticks fit at `MIN_TICK_PITCH`; beyond that the rail keeps
 * every tick individually clickable by sampling evenly spaced questions.
 *
 * `activeIndex` (when given) is always included in the sampled result so the
 * selected question stays highlighted even if it would have been skipped —
 * otherwise the active marker silently disappears on long sessions.
 */
export function minimapLayout(
  questionCount: number,
  availableHeight = DEFAULT_MINIMAP_HEIGHT_PX,
  activeIndex?: number,
): MinimapLayout {
  if (questionCount <= 0) return { pitch: MAX_TICK_PITCH, indices: [] };
  if (questionCount === 1) return { pitch: MAX_TICK_PITCH, indices: [0] };

  const usable = Math.max(0, availableHeight - MINIMAP_PADDING_PX);
  const capacity = Math.max(1, Math.floor(usable / MIN_TICK_PITCH));

  if (questionCount <= capacity) {
    const fitted = Math.floor(usable / questionCount);
    const pitch = Math.max(MIN_TICK_PITCH, Math.min(MAX_TICK_PITCH, fitted));
    return { pitch, indices: range(questionCount) };
  }

  // Too many questions to show individually: sample evenly, always including
  // the first and last so the rail still spans the whole conversation.
  const indices: number[] = [];
  let previous = -1;
  for (let i = 0; i < capacity; i += 1) {
    const index = Math.round((i * (questionCount - 1)) / (capacity - 1));
    if (index !== previous) {
      indices.push(index);
      previous = index;
    }
  }

  const active = clampIndex(activeIndex, questionCount);
  if (active !== undefined && !indices.includes(active)) {
    indices.push(active);
    indices.sort((a, b) => a - b);
  }

  return { pitch: MIN_TICK_PITCH, indices };
}

function clampIndex(index: number | undefined, count: number): number | undefined {
  if (index === undefined || index < 0 || index >= count) return undefined;
  return index;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}
