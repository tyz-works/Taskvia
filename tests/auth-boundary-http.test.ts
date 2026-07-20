// 実Next.js HTTP認証RED再現テスト: Admiral設計判断(docs/20260720_phase0_auth_gateway_decision.md)
// が明記する通り「Route Handler の単体テストだけでは、proxy.ts の NextAuth matcher と
// isAuthorized() Bearer 検証の競合を検出できない」— これがDoDの中核。
//
// 単体 handler test(tests/cards-route-bug1.test.ts 等)は GET() を直接呼び出すため
// proxy.ts を一切通過しない。実際の競合(Bearer token が正しくても、proxy が
// NextAuth session 不在を理由に route handler 到達前に 401 を返す)は、実際の
// HTTP リクエストが proxy → route handler の順で通過する経路を再現しない限り
// 検出できない。
//
// 手段(Worf裁定): `next build` で実ビルド → 標準出力設定(output:"standalone",
// task_150 Geordi導入)のビルド成果物 `.next/standalone/**/server.js` を実プロセスとして
// 起動 → 実 fetch() で HTTP リクエストを送る。`next start` は standalone 構成では
// 動作しない(next自身が警告する)ため使わない。
//
// NextAuth session の偽装には next-auth/jwt の公開API `encode()` を用いる
// (Auth.js が公式にテスト用途として提供する手法。実 Google OAuth ログインは行わない)。
// cookie 名は非 HTTPS(http://localhost)構成の既定である `authjs.session-token`
// (useSecureCookies=false 時、__Secure- prefix なし)。
//
// .env* は一切読まない — 全ての秘密情報はこのファイル内の固定 fixture 値のみ。
// 実 Upstash / 実ntfy への接続は発生しない(UPSTASH_REDIS_REST_URL は到達不能な
// dummy port を指し、かつ RED 状態では proxy が /api/cards を route handler 到達前に
// 遮断するため Redis 呼び出し自体が発生しない)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";

const PORT = 34151;
const BASE_URL = `http://localhost:${PORT}`;
const AUTH_SECRET_FIXTURE =
  "test-fixture-auth-secret-must-be-long-enough-for-encryption";
const TASKVIA_TOKEN_FIXTURE = "test-fixture-bearer-token";
const SESSION_COOKIE_NAME = "authjs.session-token";

const ROOT = process.cwd();

const RUNTIME_ENV = {
  ...process.env,
  TASKVIA_TOKEN: TASKVIA_TOKEN_FIXTURE,
  AUTH_SECRET: AUTH_SECRET_FIXTURE,
  GOOGLE_CLIENT_ID: "test-fixture-client-id",
  GOOGLE_CLIENT_SECRET: "test-fixture-client-secret",
  AUTH_TRUST_HOST: "true",
  // 到達不能な dummy port。RED 状態では proxy が先に遮断するため Redis 呼び出し
  // 自体が発生せず、この URL への実接続は起きない。
  UPSTASH_REDIS_REST_URL: "http://127.0.0.1:39999/unused",
  UPSTASH_REDIS_REST_TOKEN: "unused-fixture-token",
  PORT: String(PORT),
};

// Next.js の standalone 出力は環境により outputFileTracingRoot の推定パスが
// 想定と異なりネストすることがある(このマシンでは $HOME 直下の無関係な
// package-lock.json が原因で `.next/standalone/workspace/.worktrees/...../server.js`
// のようにネストした・本ミッションのスコープ外の環境要因)。固定パスに依存せず
// 動的に server.js を探索することでこの環境差に頑健にする。
function findServerJs(dir: string): string {
  // node_modules 配下には next 自身が持つ同名の内部ファイル
  // (例: next/dist/experimental/testmode/server.js)が複数存在するため、
  // node_modules は探索対象から除外し、standalone 出力の実エントリポイントのみを拾う。
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "server.js") return full;
    if (entry.isDirectory()) {
      const found = findServerJs(full);
      if (found) return found;
    }
  }
  return "";
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: "GET", redirect: "manual" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

async function forgeSessionCookie(): Promise<string> {
  const sessionToken = await encode({
    token: {
      sub: "test-fixture-user",
      email: "test-fixture-user@example.com",
      name: "Test Fixture User",
    },
    secret: AUTH_SECRET_FIXTURE,
    salt: SESSION_COOKIE_NAME,
  });
  return `${SESSION_COOKIE_NAME}=${sessionToken}`;
}

let serverProcess: ChildProcess | null = null;

describe("実HTTP認証境界test: proxy.ts matcherとRoute Handler認証の競合(単体handler testでは検出不能)", () => {
  beforeAll(async () => {
    try {
      execFileSync("npx", ["next", "build"], {
        cwd: ROOT,
        env: RUNTIME_ENV,
        stdio: "pipe",
        timeout: 100000,
      });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      throw new Error(
        `next build failed:\n${e.stdout?.toString()}\n${e.stderr?.toString()}`,
      );
    }

    const serverJs = findServerJs(path.join(ROOT, ".next", "standalone"));
    if (!serverJs) {
      throw new Error("standalone server.js not found under .next/standalone");
    }

    serverProcess = spawn("node", [serverJs], {
      cwd: ROOT,
      env: RUNTIME_ENV,
      stdio: "pipe",
    });

    await waitForServer(`${BASE_URL}/`, 15000);
  }, 120000);

  afterAll(() => {
    serverProcess?.kill("SIGTERM");
  });

  it("Bearer付きGET /api/cardsは200を期待するが現行は401(RED・proxyがNextAuth session不在を理由にroute handler到達前に遮断)", async () => {
    const res = await fetch(`${BASE_URL}/api/cards`, {
      headers: { Authorization: `Bearer ${TASKVIA_TOKEN_FIXTURE}` },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
  });

  it("非回帰: BearerなしGET /api/cardsは401のまま(現行もproxyのsessionチェックで401)", async () => {
    const res = await fetch(`${BASE_URL}/api/cards`, { redirect: "manual" });
    expect(res.status).toBe(401);
  });

  it("NextAuth sessionのみ(Bearerなし)でGET /api/cardsは401(現行の挙動を確認・非回帰=handlerのisAuthorizedがBearer欠如で拒否)", async () => {
    const cookie = await forgeSessionCookie();
    const res = await fetch(`${BASE_URL}/api/cards`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("未ログイン状態でUI page(/)アクセスは/loginへredirectする(現行の挙動を確認)", async () => {
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("login済み状態でUI page(/)アクセスは200で表示される(現行の挙動を確認・可能な範囲でmock=page.tsxはclient componentゆえSSR時Redis依存なし)", async () => {
    const cookie = await forgeSessionCookie();
    const res = await fetch(`${BASE_URL}/`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.text();
    expect(body).toContain("Taskvia");
  });
});
