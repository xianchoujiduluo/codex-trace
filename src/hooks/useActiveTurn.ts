import { useEffect, useState, type RefObject } from "react";

/**
 * The turn currently at the top of the transcript viewport.
 *
 * The question rail highlights "where the reader is", but a turn's selection
 * state only changes when it is opened — so scrolling, or jumping with the rail
 * itself, left the highlight behind. Deriving the active turn from scroll
 * position instead makes the rail follow the transcript however it moved.
 *
 * "Nearest the top" means the last turn whose top edge has reached (or passed)
 * the container's top edge: that is the turn the reader is looking at. When
 * every loaded turn is still below the fold — which happens on the opening
 * render, before any layout settles — the first one wins.
 */
export function useActiveTurn(
  containerRef: RefObject<HTMLElement | null>,
  turnCount: number,
): number | null {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || turnCount === 0) {
      setActiveIndex(null);
      return;
    }

    let frame = 0;

    const measure = () => {
      frame = 0;
      // No measurable viewport means there is no "top of the transcript" to be
      // near — that is the case in a headless DOM and during the first paint.
      // Leave the highlight on the selection rather than inventing a position
      // from zeroed-out rects.
      if (container.clientHeight === 0) {
        setActiveIndex(null);
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const turns = container.querySelectorAll<HTMLElement>("[data-turn-index]");
      if (turns.length === 0) return;

      // Turns carry `scroll-margin-top`, so `scrollIntoView({block: "start"})`
      // parks the turn it jumped to slightly *below* the container's top edge.
      // Without that offset the turn the reader just jumped to reads as "below
      // the fold" and the previous one stays highlighted. Read the real value so
      // the CSS stays the single source of truth.
      const margin = Number.parseFloat(getComputedStyle(turns[0]).scrollMarginTop) || 0;
      // A couple of pixels of slack: sub-pixel layout makes an exact comparison
      // fragile.
      const threshold = containerTop + margin + 2;
      let found: number | null = null;
      for (const turn of turns) {
        const index = Number(turn.dataset.turnIndex);
        if (Number.isNaN(index)) continue;
        if (turn.getBoundingClientRect().top <= threshold) found = index;
        else break;
      }

      // At the bottom of the transcript nothing more can reach the top edge, so
      // the rule above keeps returning an earlier turn even though the reader
      // asked for the last one — by scrolling or by picking its rail tick. When
      // the end is reached, the last visible turn is the one they are reading.
      //
      // `scrollable` guards the short-session case: when every turn already fits
      // there is no bottom to be at, `scrollHeight === clientHeight` would make
      // this true always, and the rail would mark the last turn on a transcript
      // the reader has not scrolled at all.
      const scrollable = container.scrollHeight - container.clientHeight > 2;
      const atBottom =
        scrollable && container.scrollHeight - container.scrollTop - container.clientHeight <= 2;
      if (atBottom) {
        const visibleBottom = container.getBoundingClientRect().bottom;
        for (const turn of turns) {
          const index = Number(turn.dataset.turnIndex);
          if (Number.isNaN(index)) continue;
          if (turn.getBoundingClientRect().top < visibleBottom) found = index;
          else break;
        }
      }
      if (found === null) {
        const first = turns[0].dataset.turnIndex;
        found = first === undefined ? null : Number(first);
      }
      setActiveIndex((previous) => (previous === found ? previous : found));
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, turnCount]);

  return activeIndex;
}
