import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { installErrorCapture, reportClientError, resetClientReporterForTests } from "@/lib/errors/clientReporter";

type Listener = (e: unknown) => void;

function fakeWindow() {
  const listeners = new Map<string, Listener[]>();
  return {
    location: { pathname: "/channels/abc" },
    navigator: { userAgent: "TestBrowser/1.0" },
    addEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    }),
    fire(type: string, e: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("clientReporter", () => {
  let win: ReturnType<typeof fakeWindow>;
  beforeEach(() => {
    resetClientReporterForTests();
    rpc.mockReset().mockResolvedValue({ data: "stored", error: null });
    win = fakeWindow();
    vi.stubGlobal("window", win);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends a scrubbed report to log_client_error", async () => {
    reportClientError(new Error("failed for a@b.co"), "boundary", "999");
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("log_client_error", expect.objectContaining({
      p_message: "failed for [email] [digest 999]",
      p_path: "/channels/abc",
      p_user_agent: "TestBrowser/1.0",
      p_kind: "boundary",
    }));
  });

  it("installs once and reports window errors and rejections, deduping repeats", async () => {
    installErrorCapture(win as unknown as Window);
    installErrorCapture(win as unknown as Window);
    expect(win.addEventListener).toHaveBeenCalledTimes(2);
    win.fire("error", { error: new Error("boom"), message: "boom" });
    win.fire("error", { error: new Error("boom"), message: "boom" });
    win.fire("unhandledrejection", { reason: "nope" });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((c) => c[1].p_kind)).toEqual(["error", "rejection"]);
  });

  it("never throws or re-reports when sending fails", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    expect(() => reportClientError(new Error("x"), "error")).not.toThrow();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    await flush();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
