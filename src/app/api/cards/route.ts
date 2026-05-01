// src/app/api/cards/route.ts
import { Redis } from "@upstash/redis";
import { parseRedisValues } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

// approval:index + approval:* の 2 コマンドを Lua スクリプトで 1 コマンドに
// 統合する。Upstash は EVALSHA を 1 command としてカウントするので、
// Free プラン (500K commands/month) 枠を約 50% 温存できる。
//
// Lua のロジック:
//   1. approval:index から直近 100 件の id を LRANGE
//   2. 各 id を approval:{id} キーに展開して MGET
//   3. 結果を文字列配列として返す (空スロットは nil)
const CARDS_SCRIPT = `
local ids = redis.call('LRANGE', KEYS[1], 0, 99)
if #ids == 0 then return {} end
local keys = {}
for i, id in ipairs(ids) do
  keys[i] = 'approval:' .. id
end
return redis.call('MGET', unpack(keys))
`;

// モジュール読み込み時に一度だけ SCRIPT LOAD し、返ってきた sha1 を再利用する。
// function instance が warm な間は 1 instance あたり 1 回の scriptLoad コスト。
// Upstash はスクリプトを自動 flush しないので、基本的にはこの sha が
// ずっと有効だが、NOSCRIPT エラーが出た場合のみ再ロードして retry する。
let scriptShaPromise: Promise<string> = redis.scriptLoad(CARDS_SCRIPT);

async function runCardsScript(): Promise<(string | null)[]> {
  try {
    const sha = await scriptShaPromise;
    return (await redis.evalsha(sha, ["approval:index"], [])) as (
      | string
      | null
    )[];
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("noscript")
    ) {
      // Redis 側からスクリプトが消えていた → 再ロードして 1 回だけ retry
      scriptShaPromise = redis.scriptLoad(CARDS_SCRIPT);
      const sha = await scriptShaPromise;
      return (await redis.evalsha(sha, ["approval:index"], [])) as (
        | string
        | null
      )[];
    }
    throw err;
  }
}

export async function GET() {
  const raws = await runCardsScript();

  if (!raws || raws.length === 0) return Response.json({ cards: [] });

  const cards = parseRedisValues(raws as (string | object | null)[]);

  return Response.json({ cards });
}
