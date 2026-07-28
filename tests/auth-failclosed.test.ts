// task_164: auth.ts の fail-closed 化の回帰テスト。
// 提督裁定(2026-07-28)により、TASKVIA_TOKEN 未設定時は open ではなく 401 とする。
//
// ★task_158 の教訓: 共有関数を直接呼ぶだけのテストは呼び出し側を守らない。
// このファイルは (A) 関数単体 と (B) 実際の Route Handler 経由 の両方を検証する。
// .env* は一切読まない。全て本ファイル内の fixture 値のみを使う。
import { describe, it, expect, afterEach } from "vitest";

const ORIGINAL_TOKEN = process.env.TASKVIA_TOKEN;

async function freshAuth() {
  // process.env の変更を反映させるため、モジュールキャッシュを捨てて再 import する
  const vitest = await import("vitest");
  vitest.vi.resetModules();
  return await import("../src/lib/auth");
}

describe("A: isAuthorized() 関数単体", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.TASKVIA_TOKEN;
    else process.env.TASKVIA_TOKEN = ORIGINAL_TOKEN;
  });

  it("TASKVIA_TOKEN 未設定なら false を返す（fail-closed）", async () => {
    delete process.env.TASKVIA_TOKEN;
    const { isAuthorized } = await freshAuth();
    expect(isAuthorized(new Request("http://localhost/api/cards"))).toBe(false);
  });

  it("TASKVIA_TOKEN が空白のみでも false を返す", async () => {
    process.env.TASKVIA_TOKEN = "   ";
    const { isAuthorized } = await freshAuth();
    expect(isAuthorized(new Request("http://localhost/api/cards"))).toBe(false);
  });

  it("token 設定済み + 正しい Bearer なら true を返す（既存挙動の非回帰）", async () => {
    process.env.TASKVIA_TOKEN = "task164-fixture-token";
    const { isAuthorized } = await freshAuth();
    const req = new Request("http://localhost/api/cards", {
      headers: { Authorization: "Bearer task164-fixture-token" },
    });
    expect(isAuthorized(req)).toBe(true);
  });

  it("token 設定済み + 誤った Bearer なら false を返す（既存挙動の非回帰）", async () => {
    process.env.TASKVIA_TOKEN = "task164-fixture-token";
    const { isAuthorized } = await freshAuth();
    const req = new Request("http://localhost/api/cards", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(isAuthorized(req)).toBe(false);
  });
});

describe("B: 実際のガード呼び出し側（Route Handler）が 401 を返す", () => {
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.TASKVIA_TOKEN;
    else process.env.TASKVIA_TOKEN = ORIGINAL_TOKEN;
  });

  it("token 未設定時、/api/cards の GET が 401 を返す", async () => {
    delete process.env.TASKVIA_TOKEN;
    const vitest = await import("vitest");
    vitest.vi.resetModules();
    // ★task_164 decomp_review F3（Picard・2026-07-28。★第2ラウンドでPicard自身が訂正）:
    // src/app/api/cards/route.ts:5 はモジュールスコープで `Redis.fromEnv()` を実行するが、
    // env未設定でも throw しない（console.warn するのみ・url/token が undefined のクライアントを
    // 構築して返す・ネットワーク接続も行わない）。モックしなくても import 時点では落ちない。
    // それでも既存の tests/cards-route-bug1.test.ts:10-27 を手本にモックする理由は、実 Upstash へ
    // 到達させずテストを hermetic に保つためである（throw を避けるためではない）。
    // isAuthorized() の呼び出しは GET の最初の1行（route.ts:56）なので、Redis へは到達しない。
    // 401 が返るという本テストの主張自体は変えない。
    vitest.vi.doMock("@upstash/redis", () => ({
      Redis: {
        fromEnv: () => ({
          scriptLoad: vitest.vi.fn().mockResolvedValue("mock-sha-cards"),
          evalsha: vitest.vi.fn().mockResolvedValue([]),
        }),
      },
    }));
    const route = await import("../src/app/api/cards/route");
    const res = await route.GET(new Request("http://localhost/api/cards"));
    expect(res.status).toBe(401);
  });
});

describe("C: 三分岐の静的チェック（回帰形も未知形も fail させる）", () => {
  it("auth.ts の token 未設定分岐が `return false` である", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/lib/auth.ts", import.meta.url),
      "utf8",
    );
    const hasFailClosed = /if\s*\(!token\)\s*return\s+false\s*;/.test(src);
    const hasFailOpen = /if\s*\(!token\)\s*return\s+true\s*;/.test(src);

    // 回帰形（fail-open）に戻されたら fail
    expect(hasFailOpen).toBe(false);
    // 正しい形が無ければ fail —— ★どちらの形も見つからない場合もここで fail する（fail-closed な検査）
    expect(hasFailClosed).toBe(true);
  });

  // ★Step 1.5(提督裁定・2026-07-28・スコープ拡大): proxy.ts(UI平面)の open-mode 分岐にも
  // auth.ts と同じ三分岐の考え方を適用する。
  it("proxy.ts に TASKVIA_TOKEN の open-mode 分岐が無く、session ガードが在る", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/proxy.ts", import.meta.url),
      "utf8",
    );
    const hasOpenModeRegression = /if\s*\(!token\)\s*return\s+NextResponse\.next\(\)/.test(src);
    const hasTaskviaTokenRef = /process\.env\.TASKVIA_TOKEN/.test(src);
    const hasSessionGuard = /if\s*\(!request\.auth\)/.test(src);

    // 回帰形（open-mode 分岐）が復元されたら fail
    expect(hasOpenModeRegression).toBe(false);
    // TASKVIA_TOKEN 参照そのものが proxy.ts から消えていること
    expect(hasTaskviaTokenRef).toBe(false);
    // session ガードが無い（両方消えて中身が空になった）未知形でも fail する（第3分岐）
    expect(hasSessionGuard).toBe(true);
  });
});
