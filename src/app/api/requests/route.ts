// src/app/api/requests/route.ts
//
// Director 依頼フォームの API。
//
// Redis データ構造:
//   mission_request:{id}      String (JSON) — MissionRequest 1件 (TTL なし)
//   mission_requests:index    List — ID 一覧 (lpush)
//
// MissionRequest フィールド:
//   id            string       nanoid
//   title         string       依頼タイトル (必須)
//   body          string       詳細説明 (必須)
//   priority      high|medium|low  優先度 (default: medium)
//   skills        string[]     必要スキル (任意)
//   target_dir    string       対象プロジェクトの絶対パス (任意、絶対パスのみ)
//   deadline_note string       期限メモ (任意)
//   mission_slug  string|null  Director が処理時に書き戻す
//   status        pending|processing|done|rejected
//   created_at    string       ISO8601
//   processed_at  string|null  処理開始/完了日時
import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { badRequest } from "@/lib/responses";
import { parseRedisValues } from "@/lib/redis-parse";

const redis = Redis.fromEnv();

const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
const VALID_STATUSES = new Set(["pending", "processing", "done", "rejected"]);

export type MissionRequest = {
  id: string;
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  skills: string[];
  target_dir: string;
  deadline_note: string;
  mission_slug: string | null;
  status: "pending" | "processing" | "done" | "rejected";
  created_at: string;
  processed_at: string | null;
};

// POST /api/requests — 依頼を新規作成して id を返す
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const body = await req.json();
  const { title, body: bodyText, priority, skills, target_dir, deadline_note } =
    body as Record<string, unknown>;

  // バリデーション
  if (!title || typeof title !== "string" || title.trim() === "") {
    return badRequest("title is required");
  }
  if (!bodyText || typeof bodyText !== "string" || bodyText.trim() === "") {
    return badRequest("body is required");
  }
  const resolvedPriority =
    typeof priority === "string" && VALID_PRIORITIES.has(priority)
      ? (priority as MissionRequest["priority"])
      : "medium";

  // target_dir は絶対パスのみ受け付ける
  if (
    target_dir !== undefined &&
    target_dir !== "" &&
    typeof target_dir === "string" &&
    !target_dir.startsWith("/")
  ) {
    return badRequest("target_dir must be an absolute path");
  }

  const resolvedSkills: string[] = Array.isArray(skills)
    ? (skills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const id = nanoid();
  const entry: MissionRequest = {
    id,
    title: title.trim(),
    body: bodyText.trim(),
    priority: resolvedPriority,
    skills: resolvedSkills,
    target_dir: typeof target_dir === "string" ? target_dir.trim() : "",
    deadline_note:
      typeof deadline_note === "string" ? deadline_note.trim() : "",
    mission_slug: null,
    status: "pending",
    created_at: new Date().toISOString(),
    processed_at: null,
  };

  await redis.set(`mission_request:${id}`, JSON.stringify(entry));
  await redis.lpush("mission_requests:index", id);

  // ntfy 通知 (新規依頼をDirectorに知らせる)
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      body: `新規依頼: ${entry.title}`,
      headers: {
        Title: "New Mission Request",
        Priority: resolvedPriority === "high" ? "high" : "default",
        Click: "https://taskvia.vercel.app",
        Tags: "memo",
      },
    }).catch(() => {});
  }

  return Response.json({ id });
}

// GET /api/requests?status=pending&limit=50 — 依頼一覧を返す
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, rawLimit))
    : 50;

  if (
    statusFilter !== null &&
    !VALID_STATUSES.has(statusFilter)
  ) {
    return badRequest("invalid status filter");
  }

  const ids = await redis.lrange<string>("mission_requests:index", 0, limit - 1);
  if (!ids.length) return Response.json({ requests: [] });

  const keys = ids.map((id) => `mission_request:${id}`);
  const raws = await redis.mget<string[]>(...keys);

  let requests = parseRedisValues<MissionRequest>(raws as (string | object | null)[]);

  if (statusFilter) {
    requests = requests.filter((r) => r.status === statusFilter);
  }

  return Response.json({ requests });
}
