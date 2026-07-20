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
// 実 Upstash / 実ntfy への接続は発生しない。GREEN化(proxy修正)後は /api/cards が
// 実際に route handler へ到達し @upstash/redis(scriptLoad+evalsha)を呼ぶため、
// このテストプロセス内に最小限のUpstash REST互換モックサーバーを立てて
// UPSTASH_REDIS_REST_URL をそこへ向ける(startMockUpstashServer参照・実Upstashへは
// 到達しない)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import http, { type Server } from "node:http";
import { encode } from "next-auth/jwt";

const PORT = 34151;
const BASE_URL = `http://localhost:${PORT}`;
const AUTH_SECRET_FIXTURE =
  "test-fixture-auth-secret-must-be-long-enough-for-encryption";
const TASKVIA_TOKEN_FIXTURE = "test-fixture-bearer-token";
const SESSION_COOKIE_NAME = "authjs.session-token";
// compose.yaml:56 と同一の fixture 値(task_150で導入)。実際の watchdog scope token。
const WATCHDOG_TOKEN_FIXTURE = "taskvia-dev-fixture-watchdog-token";

const ROOT = process.cwd();

// GREEN化(Geordi Phase2)で追記: proxy 修正後は /api/cards が実際に route handler へ
// 到達するようになるため、cards/route.ts の @upstash/redis 呼び出し(scriptLoad+evalsha)
// が実行される。RED時点の到達不能dummy portのままだと500になる(proxyがもう遮断しない
// ため)。vi.mock はこのテストが起動する spawn 子プロセスには効かないので、Upstash REST
// プロトコルを最小限だけ話す本物のHTTPサーバーをこのテストプロセス内に立て、そこへ向ける。
//
// ★@upstash/redis は既定で auto-pipelining が有効("enableAutoPipelining ?? true")なため、
// 同一tick内で連続実行される scriptLoad()→evalsha() は個別リクエストではなく単一の
// `POST {baseUrl}/pipeline`(body=コマンド配列の配列、応答=`{result}`の配列)へ自動集約
// される(単一コマンド時は`POST {baseUrl}`、応答=単一`{result}`)。両方の形状に対応する。
function mockResultFor(command: unknown[]): unknown {
  if (command[0] === "script" && command[1] === "load") return "mock-sha-cards";
  if (command[0] === "evalsha") return [];
  return null;
}

function startMockUpstashServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(raw || "[]");
        res.setHeader("Content-Type", "application/json");
        const isPipeline = (req.url ?? "").includes("pipeline");
        if (isPipeline) {
          const commands = parsed as unknown[][];
          res.end(JSON.stringify(commands.map((c) => ({ result: mockResultFor(c) }))));
          return;
        }
        res.end(JSON.stringify({ result: mockResultFor(parsed as unknown[]) }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

let mockUpstashServer: Server | null = null;
let RUNTIME_ENV: NodeJS.ProcessEnv = {};

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
    const mock = await startMockUpstashServer();
    mockUpstashServer = mock.server;

    RUNTIME_ENV = {
      ...process.env,
      TASKVIA_TOKEN: TASKVIA_TOKEN_FIXTURE,
      AUTH_SECRET: AUTH_SECRET_FIXTURE,
      GOOGLE_CLIENT_ID: "test-fixture-client-id",
      GOOGLE_CLIENT_SECRET: "test-fixture-client-secret",
      AUTH_TRUST_HOST: "true",
      UPSTASH_REDIS_REST_URL: mock.url,
      UPSTASH_REDIS_REST_TOKEN: "unused-fixture-token",
      TASKVIA_WATCHDOG_TOKEN: WATCHDOG_TOKEN_FIXTURE,
      PORT: String(PORT),
    };

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
    mockUpstashServer?.close();
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

  // ★task_152 本題: task_151 の matcher(`/((?!api|login|_next/static|_next/image|
  // favicon.ico).*)`)の除外リストに `internal` が無いため、`/internal/health/watchdog`
  // が catch-all(UI page 保護)側に落ち、NextAuth session が無いと 307→/login に
  // なってしまう。期待契約(§14.2・watchdog自身のtoken認証)は proxy を完全に
  // 迂回してこの route handler へ直接到達すること。Picard の WSL2 実機検証(amun)で
  // 初めて捕捉されたリグレッション — task_151 のこのテストファイルは watchdog path を
  // 一度も通していなかった。

  it("watchdogへの無tokenアクセスは401を期待するが現行は307(RED・proxyがUI page保護としてredirectしてしまいwatchdog自身の401ロジックに到達しない)", async () => {
    const res = await fetch(`${BASE_URL}/internal/health/watchdog`, {
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("watchdogへの誤tokenアクセスは401を期待するが現行は307(RED・同上)", async () => {
    const res = await fetch(`${BASE_URL}/internal/health/watchdog`, {
      headers: { Authorization: "Bearer wrong-watchdog-token" },
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("watchdogへの正watchdog tokenアクセスは200で集約healthを返すべきだが現行は307(RED・同上・正規の運用経路が完全に遮断されている)", async () => {
    const res = await fetch(`${BASE_URL}/internal/health/watchdog`, {
      headers: { Authorization: `Bearer ${WATCHDOG_TOKEN_FIXTURE}` },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
  });
});
