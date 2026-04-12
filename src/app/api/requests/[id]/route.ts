// src/app/api/requests/[id]/route.ts
//
// GET   /api/requests/:id — 依頼の詳細を取得する
// PATCH /api/requests/:id — Orchestrator が依頼のステータスと mission_slug を更新する
import { Redis } from "@upstash/redis";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { MissionRequest } from "../route";

const redis = Redis.fromEnv();

const VALID_STATUSES = new Set(["pending", "processing", "done", "rejected"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`mission_request:${id}`);
  if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

  const entry: MissionRequest =
    typeof raw === "string" ? JSON.parse(raw) : raw;

  return Response.json(entry);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) return unauthorized();

  const { id } = await params;
  const raw = await redis.get(`mission_request:${id}`);
  if (!raw) return Response.json({ error: "not_found" }, { status: 404 });

  const entry: MissionRequest =
    typeof raw === "string" ? JSON.parse(raw) : raw;

  const body = await req.json();
  const { status, mission_slug, processed_at } = body as Record<
    string,
    unknown
  >;

  if (
    status !== undefined &&
    (typeof status !== "string" || !VALID_STATUSES.has(status))
  ) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }

  if (status !== undefined) {
    entry.status = status as MissionRequest["status"];
  }
  if (typeof mission_slug === "string") {
    entry.mission_slug = mission_slug;
  }
  if (typeof processed_at === "string") {
    entry.processed_at = processed_at;
  } else if (status === "processing" && entry.processed_at === null) {
    // status を processing に変更した時点で processed_at を自動セット
    entry.processed_at = new Date().toISOString();
  }

  await redis.set(`mission_request:${id}`, JSON.stringify(entry));

  return Response.json({ ok: true });
}
