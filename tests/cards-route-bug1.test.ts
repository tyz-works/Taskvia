// BUG-1 RED再現テスト: GET /api/cards が isAuthorized() を一切呼んでいないため、
// TASKVIA_TOKEN の設定有無に関わらず常に無認証で全承認カードを返してしまう。
//
// このテストは「修正後にあるべき挙動」(Authorization ヘッダなし → 401)を主張する。
// 現行コード(src/app/api/cards/route.ts)は req を受け取らず isAuthorized も呼ばないため、
// このテストは現状 FAIL する。この FAIL こそが BUG-1 の実在証明である。
//
// @upstash/redis は完全にモックし、実 Upstash への接続は一切発生しない。
// .env* は読まない — TASKVIA_TOKEN はテスト内で vi.stubEnv により in-memory に設定するのみ。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockScriptLoad = vi.fn().mockResolvedValue("mock-sha-cards");
const mockEvalsha = vi.fn().mockResolvedValue([
  JSON.stringify({
    id: "card-1",
    tool: "Bash",
    agent: "Kai",
    task_title: "rm -rf /tmp/build",
    status: "pending",
  }),
]);

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({
        scriptLoad: mockScriptLoad,
        evalsha: mockEvalsha,
      }),
    },
  };
});

describe("BUG-1: GET /api/cards が認証チェックを欠いている (src/app/api/cards/route.ts:54)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockScriptLoad.mockClear();
    mockEvalsha.mockClear();
    vi.stubEnv("TASKVIA_TOKEN", "secret-token-should-be-required");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Authorization ヘッダなしのリクエストは 401 を返すべき (現状は 200 で全カードを返す = RED)", async () => {
    const { GET } = await import("@/app/api/cards/route");
    // 現行シグネチャは GET() (引数なし)。修正後は GET(req: Request) になる想定のため、
    // 型はここで意図的にキャストする(このテストは修正後シグネチャに対しても有効であるべき)。
    const typedGet = GET as unknown as (req: Request) => Promise<Response>;

    const req = new Request("http://localhost/api/cards");
    const res = await typedGet(req);

    // 修正後の期待契約: TASKVIA_TOKEN が設定されている状態で
    // Authorization ヘッダがなければ 401 Unauthorized を返すべき。
    expect(res.status).toBe(401);
  });

  it("(現状挙動の確認) 無認証でも 200 が返り承認カードの中身が漏洩する", async () => {
    const { GET } = await import("@/app/api/cards/route");
    // 現行シグネチャは GET() (引数なし)。修正後は GET(req: Request) になる想定のため、
    // 型はここで意図的にキャストする(このテストは修正後シグネチャに対しても有効であるべき)。
    const typedGet = GET as unknown as (req: Request) => Promise<Response>;

    const req = new Request("http://localhost/api/cards");
    const res = await typedGet(req);
    const body = await res.json();

    // BUG-1 が現に存在することの直接証拠: 認証なしで pending カードの詳細が読める。
    expect(res.status).toBe(200);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].id).toBe("card-1");
  });
});
