import { presentProviders, providerLabel, type ProviderFilter } from "../lib/sessionFilter";
import type { CodexSessionInfo } from "../../shared/types";

interface ProviderFilterBarProps {
  sessions: CodexSessionInfo[];
  filter: ProviderFilter;
  onChange: (filter: ProviderFilter) => void;
}

/**
 * Agent filter chips for the session sidebar. Only providers that actually
 * have sessions on this machine are offered; with a single provider present
 * the bar disappears entirely and the UI looks unchanged for codex-only users.
 */
export function ProviderFilterBar({ sessions, filter, onChange }: ProviderFilterBarProps) {
  const providers = presentProviders(sessions);
  if (providers.length <= 1) return null;

  return (
    <div className="provider-filter" role="group" aria-label="Agent filter">
      <button
        type="button"
        className={
          filter === "all"
            ? "provider-filter__chip provider-filter__chip--active"
            : "provider-filter__chip"
        }
        aria-pressed={filter === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          className={
            filter === provider
              ? "provider-filter__chip provider-filter__chip--active"
              : "provider-filter__chip"
          }
          aria-pressed={filter === provider}
          onClick={() => onChange(provider)}
        >
          {providerLabel(provider)}
        </button>
      ))}
    </div>
  );
}
