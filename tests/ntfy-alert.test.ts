// ④ntfy alert(§17.2 line886)の最小実装検証。実ntfyへの送信は一切発生しない
// (global.fetch を vi.fn でモック化)。.env* は読まない — NTFY_URL/NTFY_TOPIC は
// vi.stubEnv による in-memory 設定のみ。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({ get: vi.fn(), set: vi.fn() }),
    },
  };
});

describe("④publishOperationAlert: operation.alert を ntfy(out-of-band 1経路)へ送る", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("NTFY_URL/NTFY_TOPIC 設定時、fetch へ POST し、body に title/message/tags を含む(実送信なし・fetchはmock)", async () => {
    vi.stubEnv("NTFY_URL", "https://ntfy.example.invalid");
    vi.stubEnv("NTFY_TOPIC", "taskvia-alerts");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    vi.stubGlobal("fetch", mockFetch);

    const { publishOperationAlert } = await import("@/lib/ntfy");
    await publishOperationAlert({ title: "worker heartbeat 停止", message: "2分以上更新なし" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://ntfy.example.invalid");
    const body = JSON.parse(options.body as string);
    expect(body.topic).toBe("taskvia-alerts");
    expect(body.title).toContain("worker heartbeat 停止");
    expect(body.message).toBe("2分以上更新なし");
    expect(body.tags).toContain("warning");
  });

  it("NTFY_URL/NTFY_TOPIC 未設定時は fetch を一切呼ばない(既存ntfyPublishの黙殺契約を継承)", async () => {
    vi.stubEnv("NTFY_URL", "");
    vi.stubEnv("NTFY_TOPIC", "");

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { publishOperationAlert } = await import("@/lib/ntfy");
    await publishOperationAlert({ title: "x", message: "y" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("severity=critical なら priority=5、それ以外は priority=4", async () => {
    vi.stubEnv("NTFY_URL", "https://ntfy.example.invalid");
    vi.stubEnv("NTFY_TOPIC", "taskvia-alerts");

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", mockFetch);

    const { publishOperationAlert } = await import("@/lib/ntfy");
    await publishOperationAlert({ title: "a", message: "b", severity: "critical" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.priority).toBe(5);
  });
});
