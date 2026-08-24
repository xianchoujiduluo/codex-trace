import type { ViewState } from "../../shared/types";
import { useEffect, type RefObject } from "react";
import { IoMdSettings } from "react-icons/io";
import { VscSearch } from "react-icons/vsc";
import { CloseIcon, BackIcon, ForwardIcon } from "./Icons";

interface ViewToolbarProps {
  view: ViewState;
  hasSession: boolean;
  onGoToSessions: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onOpenSettings: () => void;
  searchOpen: boolean;
  searchQuery: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchChange: (query: string) => void;
  replyNavigation?: {
    position: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
  };
}

const scrollContainerByView: Record<ViewState, string> = {
  picker: ".picker__list",
  list: ".message-list",
  detail: ".turn-detail__body",
};

export function scrollContent(view: ViewState, to: "top" | "bottom") {
  const el = document.querySelector<HTMLElement>(scrollContainerByView[view]);
  if (el) el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight, behavior: "smooth" });
}

export function ViewToolbar({
  view,
  hasSession,
  onGoToSessions,
  onExpandAll,
  onCollapseAll,
  onOpenSettings,
  searchOpen,
  searchQuery,
  searchInputRef,
  onOpenSearch,
  onCloseSearch,
  onSearchChange,
  replyNavigation,
}: ViewToolbarProps) {
  useEffect(() => {
    if (searchOpen && view !== "picker") searchInputRef.current?.focus();
  }, [searchInputRef, searchOpen, view]);

  return (
    <div className="view-toolbar">
      {view !== "picker" && hasSession && (
        <button className="view-toolbar__btn" onClick={onGoToSessions}>
          ← Sessions
        </button>
      )}
      <button className="view-toolbar__btn" onClick={onExpandAll}>
        Expand All
      </button>
      <button className="view-toolbar__btn" onClick={onCollapseAll}>
        Collapse All
      </button>
      {view !== "picker" && searchOpen ? (
        <div className="view-toolbar__search">
          <VscSearch aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCloseSearch();
              }
            }}
            placeholder={view === "list" ? "Search turns" : "Search this turn"}
            aria-label={view === "list" ? "Search turns" : "Search this turn"}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onCloseSearch}
            aria-label="Close search"
            title="Close search"
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`view-toolbar__btn${searchOpen ? " view-toolbar__btn--active" : ""}`}
          onClick={onOpenSearch}
          aria-label="Open search"
          title="Search (/)"
        >
          <VscSearch />
        </button>
      )}
      <span className="view-toolbar__separator" />
      <button className="view-toolbar__btn" onClick={() => scrollContent(view, "top")}>
        Top
      </button>
      <button className="view-toolbar__btn" onClick={() => scrollContent(view, "bottom")}>
        Bottom
      </button>
      <span className="view-toolbar__spacer" />
      {replyNavigation && replyNavigation.total > 0 && (
        <div
          className="view-toolbar__reply-nav"
          role="navigation"
          aria-label="Codex reply navigation"
        >
          <button
            type="button"
            className="view-toolbar__btn"
            onClick={replyNavigation.onPrevious}
            disabled={replyNavigation.position <= 0}
            aria-label="Previous Codex reply"
            title="Previous Codex reply (p)"
          >
            <BackIcon />
          </button>
          <span className="view-toolbar__reply-position">
            {replyNavigation.position >= 0
              ? `${replyNavigation.position + 1}/${replyNavigation.total}`
              : `–/${replyNavigation.total}`}
          </span>
          <button
            type="button"
            className="view-toolbar__btn"
            onClick={replyNavigation.onNext}
            disabled={replyNavigation.position >= replyNavigation.total - 1}
            aria-label="Next Codex reply"
            title="Next Codex reply (n)"
          >
            <ForwardIcon />
          </button>
        </div>
      )}
      <button
        className="view-toolbar__btn"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings (,)"
      >
        <IoMdSettings />
      </button>
    </div>
  );
}
