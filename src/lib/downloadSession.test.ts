import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSession } from "./downloadSession";

describe("downloadSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the response with the server-provided filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["session"])),
      headers: new Headers({
        "Content-Disposition": "attachment; filename*=UTF-8''rollout%20session.jsonl",
      }),
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:session");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const append = vi.spyOn(document.body, "append");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await downloadSession("/home/user/.codex/sessions/2026/09/02/rollout session.jsonl");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11424/api/session/download?path=%2Fhome%2Fuser%2F.codex%2Fsessions%2F2026%2F09%2F02%2Frollout%20session.jsonl",
    );
    const anchor = append.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe("rollout session.jsonl");
    expect(anchor.href).toBe("blob:session");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:session");
  });

  it("falls back to the source filename when download metadata is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob()),
      headers: new Headers(),
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:session"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const append = vi.spyOn(document.body, "append");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    await downloadSession("C:\\sessions\\rollout.jsonl");

    expect((append.mock.calls[0][0] as HTMLAnchorElement).download).toBe("rollout.jsonl");
  });

  it("surfaces backend download errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Not Found",
        json: vi.fn().mockResolvedValue({ error: "session file disappeared" }),
      }),
    );

    await expect(downloadSession("/missing.jsonl")).rejects.toThrow("session file disappeared");
  });
});
