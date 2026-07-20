// ②fail-fast RED再現テスト: 設計書§15.1(line801付近)「TASKVIA_TOKEN が未設定または
// 空白のみなら server startup / deployment health check を失敗させ、既定で fail-fast
// とする」という契約を検証する。
//
// 現行実装(src/app/api/health/route.ts)は TASKVIA_TOKEN の状態を一切見ず、常に
// Redis へ set/get して 200 を返す(現行 open mode = src/lib/auth.ts:3-4
// `if(!token) return true` と同根の未対応領域)。このテストは「未設定/空白なら
// health check は 503 を返すべき」という修正後契約を主張するため、現行コードに
// 対して RED(FAIL)する。このFAILが②の未対応の証明である。
//
// 503 を採用する理由: Docker/K8s の health check 慣行上、readiness/liveness
// 失敗を表す標準的な HTTP status であり、既存 compose.yaml の他サービス
// healthcheck (pg_isready 等の 0/非0 終了コード相当) と対になる「失敗を機構的に
// 検知可能」な形にするため。
//
// @upstash/redis は完全にモックし、実 Upstash への接続は一切発生しない。
// .env* は読まない — TASKVIA_TOKEN はテスト内で vi.stubEnv により in-memory に
// 設定するのみ。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSet = vi.fn().mockResolvedValue("OK");
const mockGet = vi.fn().mockResolvedValue("ok");

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: () => ({
        set: mockSet,
        get: mockGet,
      }),
    },
  };
});

describe("②fail-fast: TASKVIA_TOKEN 未設定/空白時に /api/health は503を返すべき (src/lib/auth.ts:3-4 open mode の置換対象)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSet.mockClear();
    mockGet.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("TASKVIA_TOKEN が未設定(空文字)なら503を返すべき(現状は200=RED)", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "");

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();

    expect(res.status).toBe(503);
  });

  it("TASKVIA_TOKEN が空白のみ(スペース)なら503を返すべき(現状は200=RED)", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "   ");

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();

    expect(res.status).toBe(503);
  });

  it("非回帰: TASKVIA_TOKEN が正しく設定されていれば200のまま(現状PASS・GREEN化後も維持すべき契約)", async () => {
    vi.stubEnv("TASKVIA_TOKEN", "valid-token-fixture");

    const { GET } = await import("@/app/api/health/route");
    const res = await GET();

    expect(res.status).toBe(200);
  });
});
