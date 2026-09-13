import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ViewState, CodexSessionInfo, CodexToolCall, CodexTurn } from "../shared/types";
import { useSession } from "./hooks/useSession";
import { usePicker, resolveSessionsDir } from "./hooks/usePicker";
import { useToggleSet } from "./hooks/useToggleSet";
import { useKeyboard } from "./hooks/useKeyboard";
import { SidebarTree } from "./components/SidebarTree";
import { ProviderFilterBar } from "./components/ProviderFilterBar";
import { SessionPicker } from "./components/SessionPicker";
import { TurnList } from "./components/TurnList";
import { TurnDetail } from "./components/TurnDetail";
import { WorkerPanel } from "./components/WorkerPanel";
import { InfoBar } from "./components/InfoBar";
import { KeybindBar } from "./components/KeybindBar";
import { ViewToolbar } from "./components/ViewToolbar";
import { ResizeHandle } from "./components/ResizeHandle";
import { SidebarToggle } from "./components/SidebarToggle";
import { SettingsModal } from "./components/SettingsModal";
import { SessionGroupToggle } from "./components/SessionGroupToggle";
import { SidebarDirectoryActions } from "./components/SidebarDirectoryActions";
import { SidebarBatchCopyButton } from "./components/SidebarBatchCopyButton";
import {
  flattenSessionGroups,
  groupSessions,
  type SessionGroupMode,
  type SessionSortOrder,
} from "./lib/sessionGrouping";
import { isPrimarySession, providerLabel, type ProviderFilter } from "./lib/sessionFilter";
import { copyText } from "./lib/copyText";
import { matchesTurn } from "./lib/turnSearch";

const DEFAULT_SIDEBAR_WIDTH = 260;
const COLLAPSED_SIDEBAR_WIDTH = 36;
const EMPTY_TURNS: CodexTurn[] = [];

function findToolByCallId(tools: CodexToolCall[], callId: string): CodexToolCall | null {
  for (const tool of tools) {
    if (tool.call_id === callId) return tool;
    const childTurns = tool.worker_session?.turns ?? [];
    for (const turn of childTurns) {
      const found = findToolByCallId(turn.tool_calls, callId);
      if (found) return found;
    }
  }
  return null;
}

function isReplyTurn(turn: CodexTurn): boolean {
  return Boolean(turn.error || turn.agent_messages.some((message) => !message.is_reasoning));
}

export function App() {
  const [view, setView] = useState<ViewState>("picker");
  const [selectedTurn, setSelectedTurn] = useState(0);
  const [pickerSelected, setPickerSelected] = useState(0);
  const [showKeybinds, setShowKeybinds] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionGroupMode, setSessionGroupMode] = useState<SessionGroupMode>("directory");
  const [sidebarSortOrder, setSidebarSortOrder] = useState<SessionSortOrder>("newest");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sidebarSelectionMode, setSidebarSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [copyNotice, setCopyNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [workerPanelWidth, setWorkerPanelWidth] = useState(380);
  const [workerPanelCallId, setWorkerPanelCallId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [listSearchQuery, setListSearchQuery] = useState("");
  const [detailSearchQuery, setDetailSearchQuery] = useState("");
  const [replyNavTurnId, setReplyNavTurnId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const session = useSession();
  const picker = usePicker();
  const copyNoticeTimerRef = useRef<number | null>(null);
  const {
    set: expandedTools,
    toggle: toggleTool,
    clear: clearTools,
    addAll: addAllTools,
  } = useToggleSet();

  const { loadSession, loadMore } = session;
  const { discoverSessions, updateSessionOngoing, setSearchQuery: setPickerSearchQuery } = picker;

  // Auto-discover sessions on mount
  const discoveredRef = useRef(false);
  useEffect(() => {
    if (discoveredRef.current) return;
    discoveredRef.current = true;
    resolveSessionsDir()
      .then((dir) => {
        if (dir) discoverSessions(dir);
      })
      .catch(() => setShowSettings(true));
  }, [discoverSessions]);

  // Sync session watcher ongoing status into picker
  useEffect(() => {
    if (session.sessionPath) {
      updateSessionOngoing(session.sessionPath, session.session?.is_ongoing ?? false);
    }
  }, [session.sessionPath, session.session?.is_ongoing, updateSessionOngoing]);

  useEffect(() => {
    setPickerSelected((index) =>
      picker.sessions.length === 0 ? 0 : Math.min(index, picker.sessions.length - 1),
    );
  }, [picker.sessions.length]);

  const handleSelectSession = useCallback(
    (info: CodexSessionInfo) => {
      loadSession(info.path);
      setView("list");
      setSelectedTurn(0);
      setSearchOpen(false);
      setListSearchQuery("");
      setDetailSearchQuery("");
      setReplyNavTurnId(null);
      setPickerSearchQuery("");
      clearTools();
    },
    [clearTools, loadSession, setPickerSearchQuery],
  );

  const handleOpenDetail = useCallback(
    (index: number) => {
      const turn = session.session?.turns[index];
      setSelectedTurn(index);
      setView("detail");
      setSearchOpen(false);
      setListSearchQuery("");
      setDetailSearchQuery("");
      setReplyNavTurnId(turn && isReplyTurn(turn) ? turn.turn_id : null);
    },
    [session.session?.turns],
  );

  const handleLoadMore = useCallback(async () => {
    const direction = session.session?.pagination?.direction;
    const added = await loadMore();
    if (direction === "backward" && added > 0) {
      setSelectedTurn((index) => index + added);
    }
  }, [loadMore, session.session?.pagination?.direction]);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true);
    if (view === "picker") {
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>(".picker__search")?.focus(),
      );
    }
  }, [view]);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setPickerSearchQuery("");
    setListSearchQuery("");
    setDetailSearchQuery("");
  }, [setPickerSearchQuery]);

  const handleSearchChange = useCallback(
    (query: string) => {
      if (view === "picker") setPickerSearchQuery(query);
      else if (view === "list") setListSearchQuery(query);
      else setDetailSearchQuery(query);
    },
    [setPickerSearchQuery, view],
  );

  const showCopyNotice = useCallback((message: string, error = false) => {
    if (copyNoticeTimerRef.current !== null) window.clearTimeout(copyNoticeTimerRef.current);
    setCopyNotice({ message, error });
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setCopyNotice(null);
      copyNoticeTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(
    () => () => {
      if (copyNoticeTimerRef.current !== null) window.clearTimeout(copyNoticeTimerRef.current);
    },
    [],
  );

  const handleToggleSessionSelection = useCallback((info: CodexSessionInfo) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(info.id)) next.delete(info.id);
      else next.add(info.id);
      return next;
    });
  }, []);

  const handleBatchCopy = useCallback(async () => {
    if (!sidebarSelectionMode) {
      setSelectedSessionIds(new Set());
      setSidebarSelectionMode(true);
      return;
    }

    if (selectedSessionIds.size === 0) {
      setSidebarSelectionMode(false);
      return;
    }

    try {
      await copyText(Array.from(selectedSessionIds).join("\n"));
      const count = selectedSessionIds.size;
      setSelectedSessionIds(new Set());
      setSidebarSelectionMode(false);
      showCopyNotice(`Copied ${count} session ID${count === 1 ? "" : "s"}`);
    } catch {
      showCopyNotice("Could not copy session IDs", true);
    }
  }, [selectedSessionIds, showCopyNotice, sidebarSelectionMode]);

  const handleGroupModeChange = useCallback((mode: SessionGroupMode) => {
    setSessionGroupMode(mode);
    setPickerSelected(0);
  }, []);

  const sidebarDirectoryGroups = useMemo(
    () => groupSessions(picker.allSessions.filter(isPrimarySession), "directory", sidebarSortOrder),
    [picker.allSessions, sidebarSortOrder],
  );

  const expandAllDirectories = useCallback(() => setCollapsedGroups(new Set()), []);

  const collapseAllDirectories = useCallback(() => {
    setCollapsedGroups(new Set(sidebarDirectoryGroups.map((group) => group.key)));
  }, [sidebarDirectoryGroups]);

  const toggleSidebarSortOrder = useCallback(() => {
    setSidebarSortOrder((order) => (order === "newest" ? "oldest" : "newest"));
  }, []);

  const pickerNavigationSessions = useMemo(
    () => flattenSessionGroups(groupSessions(picker.sessions, sessionGroupMode)),
    [picker.sessions, sessionGroupMode],
  );

  const turns = session.session?.turns ?? EMPTY_TURNS;
  const selectedTurnData = turns[selectedTurn];
  const activeSearchQuery =
    view === "list" ? listSearchQuery : view === "detail" ? "" : picker.searchQuery;
  const replyTurns = useMemo(
    () =>
      turns
        .map((turn, index) => ({ turn, index }))
        .filter(
          ({ turn }) =>
            isReplyTurn(turn) && (view !== "list" || matchesTurn(turn, activeSearchQuery)),
        ),
    [activeSearchQuery, turns, view],
  );
  const selectedReplyPosition =
    view === "detail"
      ? replyTurns.findIndex(({ index }) => index === selectedTurn)
      : replyTurns.findIndex(({ turn }) => turn.turn_id === replyNavTurnId);

  const handleReplyNavigation = useCallback(
    (direction: 1 | -1) => {
      const current =
        view === "detail"
          ? replyTurns.findIndex(({ index }) => index === selectedTurn)
          : replyTurns.findIndex(({ turn }) => turn.turn_id === replyNavTurnId);
      const next = current < 0 ? (direction > 0 ? 0 : replyTurns.length - 1) : current + direction;
      const target = replyTurns[next];
      if (!target) return;

      setReplyNavTurnId(target.turn.turn_id);
      if (view === "detail") {
        setSelectedTurn(target.index);
        clearTools();
        setWorkerPanelCallId(null);
      } else {
        const element = document.querySelector<HTMLElement>(
          `.message-list [data-turn-index="${target.index}"]`,
        );
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [clearTools, replyNavTurnId, replyTurns, selectedTurn, view],
  );
  const workerPanelTool = useMemo(() => {
    if (!workerPanelCallId || !selectedTurnData) return null;
    return findToolByCallId(selectedTurnData.tool_calls, workerPanelCallId);
  }, [selectedTurnData, workerPanelCallId]);

  const expandAll = useCallback(() => {
    if (view === "detail") {
      const currentTurns = session.session?.turns ?? [];
      if (currentTurns[selectedTurn]) {
        addAllTools(currentTurns[selectedTurn].tool_calls.map((_, i) => i));
      }
    }
  }, [view, session.session, selectedTurn, addAllTools]);

  const collapseAll = useCallback(() => clearTools(), [clearTools]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const goToSessions = useCallback(() => setView("picker"), []);

  const closeWorkerPanel = useCallback(() => setWorkerPanelCallId(null), []);

  const handleOpenWorkerPanel = useCallback((tool: CodexToolCall) => {
    if (!tool.worker_session) return;
    setWorkerPanelCallId((current) => (current === tool.call_id ? null : tool.call_id));
  }, []);

  useEffect(() => {
    if (view !== "detail") {
      closeWorkerPanel();
      return;
    }
    if (workerPanelCallId && !workerPanelTool?.worker_session) {
      closeWorkerPanel();
    }
  }, [view, workerPanelCallId, workerPanelTool?.worker_session, closeWorkerPanel]);

  // Keyboard navigation
  useKeyboard({
    n: () => {
      if (view === "list" || view === "detail") handleReplyNavigation(1);
    },
    p: () => {
      if (view === "list" || view === "detail") handleReplyNavigation(-1);
    },
    j: () => {
      if (view === "list") setSelectedTurn((i) => Math.min(i + 1, turns.length - 1));
      if (view === "picker")
        setPickerSelected((i) => Math.min(i + 1, pickerNavigationSessions.length - 1));
    },
    k: () => {
      if (view === "list") setSelectedTurn((i) => Math.max(i - 1, 0));
      if (view === "picker") setPickerSelected((i) => Math.max(i - 1, 0));
    },
    Enter: () => {
      if (view === "list" && turns.length > 0) handleOpenDetail(selectedTurn);
      if (view === "picker" && pickerNavigationSessions.length > 0)
        handleSelectSession(pickerNavigationSessions[pickerSelected]);
    },
    Escape: () => {
      if (searchOpen) {
        handleCloseSearch();
        return;
      }
      if (workerPanelCallId) {
        closeWorkerPanel();
        return;
      }
      if (view === "detail") setView("list");
      else if (view === "list") setView("picker");
    },
    "/": handleOpenSearch,
    q: () => {
      if (workerPanelCallId) {
        closeWorkerPanel();
        return;
      }
      if (view === "detail") setView("list");
      else if (view === "list") setView("picker");
    },
    ",": () => setShowSettings(true),
    "?": () => setShowKeybinds((p) => !p),
  });

  return (
    <div className="app">
      {/* Info bar — only when session loaded and not in picker */}
      {session.sessionPath && view !== "picker" && session.session && (
        <InfoBar session={session.session} />
      )}

      {/* View toolbar */}
      <ViewToolbar
        view={view}
        hasSession={!!session.sessionPath}
        onGoToSessions={goToSessions}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onOpenSettings={() => setShowSettings(true)}
        searchOpen={searchOpen}
        searchQuery={
          view === "picker"
            ? picker.searchQuery
            : view === "list"
              ? listSearchQuery
              : detailSearchQuery
        }
        searchInputRef={searchInputRef}
        onOpenSearch={handleOpenSearch}
        onCloseSearch={handleCloseSearch}
        onSearchChange={handleSearchChange}
        replyNavigation={
          view === "list" || view === "detail"
            ? {
                position: selectedReplyPosition,
                total: replyTurns.length,
                onPrevious: () => handleReplyNavigation(-1),
                onNext: () => handleReplyNavigation(1),
              }
            : undefined
        }
      />

      <div className="app-body">
        {/* Left sidebar */}
        <div
          className={`app__sidebar${sidebarCollapsed ? " app__sidebar--collapsed" : ""}`}
          style={{
            width: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
            minWidth: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth,
          }}
        >
          <div className="app__sidebar-header">
            <span className="app__sidebar-title">SESSIONS</span>
            <div className="app__sidebar-actions">
              {" "}
              {!sidebarCollapsed && sessionGroupMode === "directory" && (
                <SidebarDirectoryActions
                  sortOrder={sidebarSortOrder}
                  onExpandAll={expandAllDirectories}
                  onCollapseAll={collapseAllDirectories}
                  onToggleSort={toggleSidebarSortOrder}
                />
              )}
              {!sidebarCollapsed && (
                <SidebarBatchCopyButton
                  active={sidebarSelectionMode}
                  selectedCount={selectedSessionIds.size}
                  onClick={() => void handleBatchCopy()}
                />
              )}
              {!sidebarCollapsed && (
                <SessionGroupToggle
                  mode={sessionGroupMode}
                  compact
                  onChange={handleGroupModeChange}
                />
              )}
              <SidebarToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
            </div>
          </div>
          {!sidebarCollapsed && (
            <ProviderFilterBar
              sessions={picker.allSessions}
              filter={providerFilter}
              onChange={setProviderFilter}
            />
          )}
          {!sidebarCollapsed && (
            <SidebarTree
              sessions={picker.allSessions}
              selectedPath={session.sessionPath || null}
              groupMode={sessionGroupMode}
              sortOrder={sessionGroupMode === "directory" ? sidebarSortOrder : "newest"}
              selectionMode={sidebarSelectionMode}
              selectedSessionIds={selectedSessionIds}
              collapsedDates={collapsedGroups}
              providerFilter={providerFilter}
              onSelectSession={handleSelectSession}
              onToggleSessionSelection={handleToggleSessionSelection}
              onToggleDate={handleToggleGroup}
              onDownloadError={(message) => showCopyNotice(message, true)}
            />
          )}
        </div>

        {copyNotice && (
          <div
            className={`app__copy-notice${copyNotice.error ? " app__copy-notice--error" : ""}`}
            role={copyNotice.error ? "alert" : "status"}
          >
            {copyNotice.message}
          </div>
        )}

        {!sidebarCollapsed && <ResizeHandle onResize={setSidebarWidth} />}

        {/* Main content */}
        <div className="main-content">
          {view === "picker" && (
            <SessionPicker
              sessions={pickerNavigationSessions}
              loading={picker.loading}
              searchQuery={picker.searchQuery}
              sessionFilter={picker.sessionFilter}
              groupMode={sessionGroupMode}
              selectedIndex={pickerSelected}
              onSelectSession={handleSelectSession}
              onSearchChange={picker.setSearchQuery}
              onSessionFilterChange={picker.setSessionFilter}
              onGroupModeChange={handleGroupModeChange}
              onCloseSearch={handleCloseSearch}
            />
          )}

          {view === "list" && session.loading && (
            <div className="app__loading">Loading session…</div>
          )}

          {view === "list" && !session.loading && session.session && (
            <TurnList
              turns={turns}
              selectedIndex={selectedTurn}
              pagination={session.session.pagination}
              loadingMore={session.loadingMore}
              onLoadMore={handleLoadMore}
              searchQuery={listSearchQuery}
              onSelectTurn={handleOpenDetail}
              providerName={
                session.session ? providerLabel(session.session.provider ?? "codex") : "Codex"
              }
            />
          )}

          {view === "detail" && turns[selectedTurn] && (
            <TurnDetail
              turn={turns[selectedTurn]}
              expanded={expandedTools}
              onToggle={toggleTool}
              onBack={() => setView("list")}
              openWorkerCallId={workerPanelCallId}
              onOpenWorkerPanel={handleOpenWorkerPanel}
              searchQuery={detailSearchQuery}
            />
          )}
        </div>

        {view === "detail" && workerPanelTool?.worker_session && (
          <>
            <ResizeHandle onResize={setWorkerPanelWidth} side="right" />
            <WorkerPanel
              session={workerPanelTool.worker_session}
              sourceTool={workerPanelTool}
              activeWorkerCallId={workerPanelCallId}
              style={{ flex: `0 0 ${workerPanelWidth}px`, maxWidth: workerPanelWidth }}
              onClose={closeWorkerPanel}
              onOpenWorker={handleOpenWorkerPanel}
            />
          </>
        )}
      </div>

      {/* Bottom keybind bar */}
      <KeybindBar
        view={view}
        showHints={showKeybinds}
        onToggle={() => setShowKeybinds((p) => !p)}
      />

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={(dir) => {
            discoverSessions(dir);
          }}
          onFrontendUpdated={() => window.location.reload()}
        />
      )}
    </div>
  );
}
