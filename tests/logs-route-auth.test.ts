// task_157 RED再現テスト: GET /api/logs が一切の認証チェックを持たず、
// agent:logs (エージェント実行コマンド履歴・数ヶ月分) を無条件に無認証で返している。
//
// 修正方針(Picard/Admiral判断・Geordiが独立再検証済み): Bearer/isAuthorized() ではなく
// NextAuth session チェックを route handler 内部に追加する。理由:
//   - src/app/page.tsx:839 の client fetch("/api/logs") は Authorization ヘッダを一切
//     送らない(ブラウザ Logs タブの唯一の呼び出し元であり、生の fetch はこの1箇所のみ)。
//     Bearer token を要求すると Logs タブ自体が壊れる。
//   - route.ts のコメント(元々の設計意図=NextAuth保護)は src/proxy.ts の
//     `/api/**` matcher除外という後発のAdmiral決定(docs/20260720_phase0_auth_gateway_decision.md §1)
//     より古く、その意味では古い記述だが、「各 route handler が自分の認証を検証する」という
//     同決定の原則には session チェックも適合する(matcher には触れない・route内部で完結)。
//   - crewvia 側のエージェント呼び出し元は 0 件(agents は単数形 /api/log へ POST する。
//     Geordiが .sh/.py/.yaml/.md 全数grepで再確認済み)であり、この endpoint はログイン済み
//     ブラウザ UI 専用と判断できる。
//
// @upstash/redis と @/auth は完全にモックし、実 Upstash・実 Google OAuth への接続は発生しない。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLrange = vi.fn().mockResolvedValue([
  JSON.stringify({
    type: "work",
    content: "did something",
    task_title: "task",
    task_id: "t1",
    agent: "Geordi",
    timestamp: "2026-07-26T00:00:00Z",
  }),
]);

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({
        lrange: mockLrange,
      }),
    },
  };
});

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: mockAuth,
}));

describe("task_157: GET /api/logs が認証チェックを欠いている (src/app/api/logs/route.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLrange.mockClear();
    mockAuth.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NextAuth sessionなしのリクエストは401を返すべき(現状は200で全ログを返す = RED)", async () => {
    mockAuth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/logs/route");
    const typedGet = GET as unknown as (req: Request) => Promise<Response>;

    const req = new Request("http://localhost/api/logs");
    const res = await typedGet(req);

    expect(res.status).toBe(401);
  });

  it("NextAuth sessionがあれば200でログが返る(非回帰)", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "test-fixture-user@example.com" },
      expires: "2099-01-01T00:00:00Z",
    });
    const { GET } = await import("@/app/api/logs/route");
    const typedGet = GET as unknown as (req: Request) => Promise<Response>;

    const req = new Request("http://localhost/api/logs");
    const res = await typedGet(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].agent).toBe("Geordi");
  });
});
