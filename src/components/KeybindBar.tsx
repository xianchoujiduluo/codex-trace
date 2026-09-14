import type { ViewState } from "../../shared/types";
import { FRONTEND_VERSION } from "../lib/version";

interface KeybindBarProps {
  view: ViewState;
  showHints?: boolean;
  onToggle?: () => void;
}

interface KeyHint {
  key: string;
  label: string;
}

const pickerKeys: KeyHint[] = [
  { key: "j/k", label: "nav" },
  { key: "Enter", label: "open" },
  { key: "/", label: "search" },
];

const listKeys: KeyHint[] = [
  { key: "j/k", label: "nav" },
  { key: "Enter", label: "detail" },
  { key: "q", label: "sessions" },
  { key: "n/p", label: "replies" },
  { key: "/", label: "search" },
];

const detailKeys: KeyHint[] = [
  { key: "j/k", label: "items" },
  { key: "Tab", label: "toggle" },
  { key: "q/Esc", label: "back" },
  { key: "n/p", label: "replies" },
  { key: "/", label: "search" },
];

function getKeys(view: ViewState): KeyHint[] {
  switch (view) {
    case "picker":
      return pickerKeys;
    case "list":
      return listKeys;
    case "detail":
      return detailKeys;
  }
}

export function KeybindBar({ view, showHints = true, onToggle }: KeybindBarProps) {
  const keys = getKeys(view);
  return (
    <div className="keybind-bar">
      {showHints &&
        keys.map((hint) => (
          <span key={hint.key} className="keybind-bar__item">
            <span className="keybind-bar__key">{hint.key}</span>
            <span className="keybind-bar__label">{hint.label}</span>
          </span>
        ))}
      {onToggle && (
        <button
          className="keybind-bar__toggle"
          onClick={onToggle}
          title={showHints ? "Hide keybinds" : "Show keybinds"}
        >
          ?
        </button>
      )}
      <span className="keybind-bar__version" title="Frontend version">
        v{FRONTEND_VERSION}
      </span>
    </div>
  );
}
