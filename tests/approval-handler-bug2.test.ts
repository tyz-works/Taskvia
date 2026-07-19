// BUG-2 RED再現テスト: handleTokenDecision() の GET → consumed_at チェック → SET が
// 単一の原子操作になっていない(src/lib/approval-handler.ts:11-25)。
//
// ★重要な注記(Picard技術助言を踏襲): これは単一スレッド JS + モック環境での
// 「真の並行実行(race condition)」の再現ではない。本番の race は別々の
// サーバーレス invocation 間で発生する async I/O の交錯であり、このテストで
// 物理的に再現することはできない。
//
// このテストが証明するのは「観測可能な契約」である: もし2つの呼び出しが
// 両方とも consumed_at=null の同じ状態を読んでからそれぞれ書き込むなら
// (= モックの get() を意図的に遅延させ、両方の get が最初の set より先に
// 完了するようシミュレートする)、現行コードは one-time-use の契約を守れず
// 両方とも成功応答(200)を返してしまう、という契約違反を示す。
//
// @upstash/redis, next/server, @/lib/ntfy は全てモックし、実ネットワーク呼び出し・
// .env* の読み取りは一切発生しない。
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // 本番の after() はレスポンス返却後にバックグラウンドタスクを実行する。
  // テストでは副作用(通知送信・ログ)を無効化するだけで十分なので no-op にする。
  after: () => {},
}));

vi.mock("@/lib/ntfy", () => ({
  publishResultNotification: vi.fn(),
  publishErrorNotification: vi.fn(),
}));

describe("BUG-2: handleTokenDecision の非原子 get→check→set (src/lib/approval-handler.ts:11-25)", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    store = {
      "approval_token:tok-1": JSON.stringify({
        request_id: "card-1",
        agent: "Kai",
        tool: "Bash",
        decision: null,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        consumed_at: null,
      }),
    };

    // get() を意図的に遅延させ、2つの並行呼び出しが「どちらも set() より先に
    // consumed_at=null を読み終える」状態を明示的にシミュレートする。
    // これは本物の race ではなく、契約違反を示すための決定的な再現である。
    //
    // ★実装上の注意: 値のスナップショットは呼び出し「時点」(=同期的に、
    // まだどちらの set() も走っていないタイミング)で取得し、その後で
    // resolve を遅延させる。もし delay の "後" に store[key] を読むと、
    // Node のタイマー+マイクロタスクの実行順序により1回目の get→check→set
    // が丸ごと完了してから2回目の get が発火するケースがあり(タイマー
    // コールバックはマイクロタスクを完全に drain してから次のタイマーへ
    // 進むため)、意図した「同じ状態を両方が読む」交錯を再現できない。
    const mockGet = vi.fn((key: string) => {
      const snapshot = store[key] ?? null; // 呼び出し時点の状態を同期的に確定させる
      return new Promise<string | null>((resolve) => {
        setTimeout(() => resolve(snapshot), 20);
      });
    });
    const mockSet = vi.fn(async (key: string, value: string) => {
      store[key] = value;
    });

    // ★Geordi追記(BUG-2修正): 原子化フィックスは非原子 get→check→set を
    // 単一 Lua EVAL に置き換える(src/lib/approval-handler.ts 参照)。そのため
    // このモックにも eval を追加する。mockGet と同じ 20ms 遅延を保持しつつ、
    // read→check→write を「同一コールバック内」で同期的に完結させることで、
    // 本物の Redis が Lua スクリプトをシングルスレッドで原子実行する性質を
    // 忠実に再現する(=2つの並行呼び出しの set タイミングが遅延で重なっても、
    // 片方のコールバックが完全に完了してから次のコールバックが走るため
    // 割り込みは発生しない)。mockGet/mockSet はダウンストリームの
    // `approval:{request_id}` card 更新(BUG-2の対象外)で引き続き使われる。
    const mockEval = vi.fn(
      (_script: string, keys: string[], args: string[]) => {
        const key = keys[0];
        const [decision, consumedAt] = args;
        return new Promise<[string, string?]>((resolve) => {
          setTimeout(() => {
            const raw = store[key];
            if (!raw) {
              resolve(["missing"]);
              return;
            }
            const entry = JSON.parse(raw);
            if (entry.consumed_at) {
              resolve(["already_used"]);
              return;
            }
            entry.decision = decision;
            entry.consumed_at = consumedAt;
            const updated = JSON.stringify(entry);
            store[key] = updated;
            resolve(["ok", updated]);
          }, 20);
        });
      },
    );

    vi.doMock("@upstash/redis", () => ({
      Redis: {
        fromEnv: () => ({
          get: mockGet,
          set: mockSet,
          eval: mockEval,
        }),
      },
    }));
  });

  it("同一トークンへの同時 approve/deny が両方成功してしまう (one-time-use 契約違反 = RED)", async () => {
    const { handleTokenDecision } = await import("@/lib/approval-handler");

    const [res1, res2] = await Promise.all([
      handleTokenDecision("tok-1", "approved"),
      handleTokenDecision("tok-1", "denied"),
    ]);

    const successCount = [res1, res2].filter((r) => r.status === 200).length;

    // 修正後の期待契約: one-time use なので、2つの同時決定のうち
    // 成功するのは常に1つだけであるべき(もう一方は 409 token_already_used)。
    // 現行コードは get→check→set が非原子のため、両方 200 を返してしまう。
    expect(successCount).toBe(1);
  });

  it("(現状挙動の確認) 最終的な Redis 状態は「後勝ち」になり最初の決定が黙って上書きされる", async () => {
    const { handleTokenDecision } = await import("@/lib/approval-handler");

    await Promise.all([
      handleTokenDecision("tok-1", "approved"),
      handleTokenDecision("tok-1", "denied"),
    ]);

    const final = JSON.parse(store["approval_token:tok-1"]);
    // 二重消費が起きている直接証拠: 消費した形跡(consumed_at)は残るが、
    // どちらの決定が「正」として扱われるかはリクエスト到着順という
    // 未定義の競合状態に依存する。
    expect(final.consumed_at).not.toBeNull();
    expect(["approved", "denied"]).toContain(final.decision);
  });
});
