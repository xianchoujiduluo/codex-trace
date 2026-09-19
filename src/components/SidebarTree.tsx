import { useCallback, useMemo, useState } from "react";
import type { CodexSessionInfo } from "../../shared/types";
import { formatFileSize, timeAgo } from "../../shared/format";
import { copyText } from "../lib/copyText";
import { downloadSession } from "../lib/downloadSession";
import { sessionDisplayName } from "../lib/sessionDisplay";
import {
  filterSessionsByProvider,
  isPrimarySession,
  providerLabel,
  sessionProvider,
  type ProviderFilter,
} from "../lib/sessionFilter";
import { sessionRelativePath } from "../lib/sessionPath";
import {
  groupSessions,
  type SessionGroupMode,
  type SessionSortOrder,
} from "../lib/sessionGrouping";
import { OngoingDots } from "./OngoingDots";
import { SubagentMarker } from "./SubagentMarker";
import {
  VscCheck,
  VscCopy,
  VscDownload,
  VscFile,
  VscFolderOpened,
  VscLoading,
} from "react-icons/vsc";

const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

interface SidebarTreeProps {
  sessions: CodexSessionInfo[];
  selectedPath: string | null;
  groupMode?: SessionGroupMode;
  sortOrder?: SessionSortOrder;
  selectionMode?: boolean;
  selectedSessionIds?: ReadonlySet<string>;
  collapsedDates: Set<string>;
  providerFilter?: ProviderFilter;
  onSelectSession: (info: CodexSessionInfo) => void;
  onToggleSessionSelection?: (info: CodexSessionInfo) => void;
  onToggleDate: (groupKey: string) => void;
  onDownloadError?: (message: string) => void;
}

export function SidebarTree({
  sessions,
  selectedPath,
  groupMode = "date",
  sortOrder = "newest",
  selectionMode = false,
  selectedSessionIds = EMPTY_SESSION_IDS,
  collapsedDates,
  providerFilter = "all",
  onSelectSession,
  onToggleSessionSelection,
  onToggleDate,
  onDownloadError,
}: SidebarTreeProps) {
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<
    { path: string; status: "loading" | "success" | "error" } | undefined
  >();
  const primarySessions = useMemo(
    () => filterSessionsByProvider(sessions, providerFilter).filter(isPrimarySession),
    [sessions, providerFilter],
  );
  const grouped = useMemo(
    () => groupSessions(primarySessions, groupMode, sortOrder),
    [primarySessions, groupMode, sortOrder],
  );

  const handleToggleGroup = useCallback(
    (e: React.MouseEvent, groupKey: string) => {
      e.stopPropagation();
      onToggleDate(groupKey);
    },
    [onToggleDate],
  );

  const handleCopy = useCallback(
    async (session: CodexSessionInfo, target: "id" | "path" | "fullPath") => {
      const copyKey = `${session.path}:${target}`;
      const value =
        target === "id"
          ? session.id
          : target === "fullPath"
            ? session.path
            : sessionRelativePath(session.path, session.date_group);
      try {
        await copyText(value);
        setCopiedTarget(copyKey);
        window.setTimeout(
          () => setCopiedTarget((current) => (current === copyKey ? null : current)),
          1500,
        );
      } catch {
        setCopiedTarget(null);
      }
    },
    [],
  );

  const handleDownload = useCallback(
    async (session: CodexSessionInfo) => {
      if (downloadState?.path === session.path && downloadState.status === "loading") return;

      setDownloadState({ path: session.path, status: "loading" });
      try {
        await downloadSession(session.path);
        setDownloadState({ path: session.path, status: "success" });
        window.setTimeout(
          () =>
            setDownloadState((current) =>
              current?.path === session.path && current.status === "success" ? undefined : current,
            ),
          1500,
        );
      } catch (error) {
        setDownloadState({ path: session.path, status: "error" });
        onDownloadError?.(
          `Could not download session file: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        window.setTimeout(
          () =>
            setDownloadState((current) =>
              current?.path === session.path && current.status === "error" ? undefined : current,
            ),
          2500,
        );
      }
    },
    [downloadState, onDownloadError],
  );

  if (primarySessions.length === 0) {
    return (
      <div className="sidebar-tree sidebar-tree--empty">
        <span className="sidebar-tree__empty">No sessions</span>
      </div>
    );
  }

  return (
    <div className="sidebar-tree">
      {grouped.map((group) => {
        const collapsed = collapsedDates.has(group.key);
        return (
          <div key={group.key} className="sidebar-tree__group">
            <div
              className="sidebar-tree__group-header"
              title={group.title}
              onClick={(e) => handleToggleGroup(e, group.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onToggleDate(group.key);
              }}
            >
              <span className="sidebar-tree__chevron">{collapsed ? "▶" : "▼"}</span>
              <span className="sidebar-tree__group-label">{group.label}</span>
              <span className="sidebar-tree__count">{group.items.length}</span>
            </div>

            {!collapsed &&
              group.items.map((s) => {
                const isSelected = s.path === selectedPath;
                const isChecked = selectedSessionIds.has(s.id);
                const displayName = sessionDisplayName(s);
                const currentDownload =
                  downloadState?.path === s.path ? downloadState.status : null;
                const downloadLabel =
                  currentDownload === "loading"
                    ? "Downloading session file"
                    : currentDownload === "success"
                      ? "Downloaded session file"
                      : currentDownload === "error"
                        ? "Retry downloading session file"
                        : "Download session file";

                return (
                  <div
                    key={s.path}
                    className={[
                      "sidebar-tree__session",
                      isSelected ? "sidebar-tree__session--selected" : "",
                      s.is_ongoing ? "sidebar-tree__session--ongoing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() =>
                      selectionMode ? onToggleSessionSelection?.(s) : onSelectSession(s)
                    }
                    role={selectionMode ? undefined : "button"}
                    tabIndex={selectionMode ? undefined : 0}
                    onKeyDown={(e) => {
                      if (!selectionMode && e.key === "Enter") onSelectSession(s);
                    }}
                  >
                    <div className="sidebar-tree__session-row">
                      {selectionMode && (
                        <input
                          type="checkbox"
                          className="sidebar-tree__session-checkbox"
                          checked={isChecked}
                          aria-label={`Select session ${s.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onToggleSessionSelection?.(s)}
                        />
                      )}
                      <span className="sidebar-tree__session-label" title={displayName}>
                        {displayName}
                      </span>
                      {sessionProvider(s) !== "codex" && (
                        <span
                          className="sidebar-tree__provider-badge"
                          title={providerLabel(sessionProvider(s))}
                        >
                          {providerLabel(sessionProvider(s))}
                        </span>
                      )}
                      <SubagentMarker count={s.spawned_worker_ids.length} />
                      {s.is_ongoing && <OngoingDots count={1} />}
                      <span className="sidebar-tree__size">
                        {formatFileSize(s.file_size_bytes)}
                      </span>
                      <span className="sidebar-tree__time">{timeAgo(s.last_activity_time)}</span>
                      {!selectionMode && (
                        <span
                          className={`sidebar-tree__copy-actions${copiedTarget?.startsWith(`${s.path}:`) ? " sidebar-tree__copy-actions--visible" : ""}`}
                        >
                          <button
                            type="button"
                            className={`sidebar-tree__copy-button${copiedTarget === `${s.path}:id` ? " sidebar-tree__copy-button--copied" : ""}`}
                            aria-label={
                              copiedTarget === `${s.path}:id`
                                ? "Copied session ID"
                                : "Copy session ID"
                            }
                            title={
                              copiedTarget === `${s.path}:id`
                                ? "Copied session ID"
                                : "Copy session ID"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopy(s, "id");
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {copiedTarget === `${s.path}:id` ? <VscCheck /> : <VscCopy />}
                          </button>
                          <button
                            type="button"
                            className={`sidebar-tree__copy-button${copiedTarget === `${s.path}:path` ? " sidebar-tree__copy-button--copied" : ""}`}
                            aria-label={
                              copiedTarget === `${s.path}:path`
                                ? "Copied session path"
                                : "Copy session path"
                            }
                            title={
                              copiedTarget === `${s.path}:path`
                                ? "Copied session path"
                                : "Copy session path"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopy(s, "path");
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {copiedTarget === `${s.path}:path` ? <VscCheck /> : <VscFile />}
                          </button>
                          <button
                            type="button"
                            className={`sidebar-tree__copy-button${copiedTarget === `${s.path}:fullPath` ? " sidebar-tree__copy-button--copied" : ""}`}
                            aria-label={
                              copiedTarget === `${s.path}:fullPath`
                                ? "Copied full session path"
                                : "Copy full session path"
                            }
                            title={
                              copiedTarget === `${s.path}:fullPath`
                                ? "Copied full session path"
                                : "Copy full session path"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCopy(s, "fullPath");
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {copiedTarget === `${s.path}:fullPath` ? (
                              <VscCheck />
                            ) : (
                              <VscFolderOpened />
                            )}
                          </button>
                          <button
                            type="button"
                            className={`sidebar-tree__copy-button${currentDownload === "success" ? " sidebar-tree__copy-button--copied" : ""}`}
                            aria-label={downloadLabel}
                            title={downloadLabel}
                            disabled={currentDownload === "loading"}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownload(s);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            {currentDownload === "loading" ? (
                              <VscLoading />
                            ) : currentDownload === "success" ? (
                              <VscCheck />
                            ) : (
                              <VscDownload />
                            )}
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
