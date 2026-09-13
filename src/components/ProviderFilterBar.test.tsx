import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CodexSessionInfo } from "../../shared/types";
import { ProviderFilterBar } from "./ProviderFilterBar";

function makeSession(id: string, provider?: string): CodexSessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: null,
    git_branch: null,
    originator: null,
    model: null,
    cli_version: null,
    thread_name: id,
    turn_count: 1,
    start_time: "2026-08-20T12:00:00Z",
    end_time: null,
    total_tokens: null,
    is_ongoing: false,
    is_external_worker: false,
    is_inline_worker: false,
    is_headless: false,
    is_archived: false,
    approval_mode: null,
    history_base_thread_id: null,
    last_activity_time: "2026-08-20T12:00:00Z",
    file_size_bytes: 0,
    worker_nickname: null,
    worker_role: null,
    spawned_worker_ids: [],
    date_group: "2026/08/20",
    ai_title: null,
    provider,
  };
}

describe("ProviderFilterBar", () => {
  it("renders nothing when only one provider has sessions", () => {
    const { container } = render(
      <ProviderFilterBar sessions={[makeSession("a", "codex")]} filter="all" onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows chips for every provider present plus the all chip", () => {
    render(
      <ProviderFilterBar
        sessions={[makeSession("a", "codex"), makeSession("b", "claude"), makeSession("c", "pi")]}
        filter="all"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pi" })).toBeInTheDocument();
  });

  it("marks the active chip and notifies on selection", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ProviderFilterBar
        sessions={[makeSession("a", "codex"), makeSession("b", "pi")]}
        filter="all"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "pi" }));
    expect(onChange).toHaveBeenCalledWith("pi");

    rerender(
      <ProviderFilterBar
        sessions={[makeSession("a", "codex"), makeSession("b", "pi")]}
        filter="pi"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "pi" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });
});
