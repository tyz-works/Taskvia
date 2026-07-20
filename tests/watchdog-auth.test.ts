// ③watchdog auth RED再現テスト: 設計書§14.2(line780-789付近)「`/internal/health/watchdog`
// は health 読取専用の watchdog scope token を timing-safe に検証する。dependency 障害時も
// 認証を迂回してはならない。応答には接続文字列、内部hostname、version詳細、error stackを
// 含めない」という契約を検証する。
//
// ★想定実装パス: src/app/internal/health/watchdog/route.ts
// Caddyfile(docker/Caddyfile)の `handle /internal/health/watchdog` は /api プレフィックス
// なしのパスへ reverse_proxy する。既存の全 API route(cards/health等)は src/app/api/ 配下
// にあるが、URL を `/internal/health/watchdog` (api プレフィックスなし)に一致させるには
// Next.js App Router 上 src/app/internal/health/watchdog/route.ts に置く必要がある。
// Geordi Phase2実装時にこのパスと一致させること。異なるパスを採用する場合はこのテストの
// import パスを合わせて調整すること。
//
// ★想定env var名: TASKVIA_WATCHDOG_TOKEN (仮。既存 TASKVIA_TOKEN と対の命名を想定。
// Geordi実装時に別名を採用する場合はテスト側を合わせて修正すること)。
//
// endpoint は現時点で未実装(Phase1のCaddyfileはreverse_proxy配線のみでtaskvia側に
// 実体なし=404、docker/Caddyfileのコメントにも明記済み)。よってこのテストは
// import 自体が解決できず失敗し RED になる — これが③の未対応の証明である。
//
// @upstash/redis は完全にモックし、実 Upstash への接続は一切発生しない。.env* は読まない。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn().mockResolvedValue("ok");
const mockSet = vi.fn().mockResolvedValue("OK");

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({ get: mockGet, set: mockSet }),
    },
  };
});

// 機微情報リークを検知するための走査パターン(設計書が名指しで禁止する項目に対応)。
const LEAK_PATTERNS: RegExp[] = [
  /postgres(ql)?:\/\//i, // 接続文字列
  /redis:\/\//i, // 接続文字列
  /redis-http/i, // 内部hostname(compose.yamlのservice名)
  /\btaskvia-dev-fixture/i, // compose.yamlのfixture値そのもの
  /\bat .+\(.+:\d+:\d+\)/, // stack trace特有の "at file:line:col" パターン
  /node_modules/i, // stack traceに現れるパス断片
  /\bv\d+\.\d+\.\d+\b/, // version文字列 (例: v22.1.0)
];

function assertNoLeak(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const pattern of LEAK_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

describe("③watchdog auth: /internal/health/watchdog は watchdog scope token 必須・認証失敗時に機微情報を返さない", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGet.mockClear();
    mockSet.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Authorizationヘッダなしは401を返し、bodyに機微情報を含まない(現状はモジュール未実装でRED)", async () => {
    vi.stubEnv("TASKVIA_WATCHDOG_TOKEN", "watchdog-secret-fixture");

    const { GET } = await import("@/app/internal/health/watchdog/route");
    const req = new Request("http://localhost/internal/health/watchdog");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeak(body);
  });

  it("誤ったtokenは401を返し、bodyに機微情報を含まない(現状RED)", async () => {
    vi.stubEnv("TASKVIA_WATCHDOG_TOKEN", "watchdog-secret-fixture");

    const { GET } = await import("@/app/internal/health/watchdog/route");
    const req = new Request("http://localhost/internal/health/watchdog", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeak(body);
  });

  it("依存先(Redis)障害時も認証を迂回してはならない=未認証なら障害情報より先に401を返す(現状RED)", async () => {
    vi.stubEnv("TASKVIA_WATCHDOG_TOKEN", "watchdog-secret-fixture");
    mockGet.mockRejectedValueOnce(new Error("ECONNREFUSED redis-http:80"));

    const { GET } = await import("@/app/internal/health/watchdog/route");
    const req = new Request("http://localhost/internal/health/watchdog");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    assertNoLeak(body);
  });

  it("正しいtokenなら200で集約healthを返し、機微情報を含まない(現状RED・未実装)", async () => {
    vi.stubEnv("TASKVIA_WATCHDOG_TOKEN", "watchdog-secret-fixture");

    const { GET } = await import("@/app/internal/health/watchdog/route");
    const req = new Request("http://localhost/internal/health/watchdog", {
      headers: { Authorization: "Bearer watchdog-secret-fixture" },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    assertNoLeak(body);
    // §14.2の集約health最低限の形: web liveness + 依存先ステータス
    expect(body).toHaveProperty("web");
    expect(["healthy", "degraded", "unreachable"]).toContain(body.postgres);
    expect(["healthy", "degraded", "unreachable"]).toContain(body.redis);
  });
});
