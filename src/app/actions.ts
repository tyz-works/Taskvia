"use server";

import { Redis } from "@upstash/redis";
import { nanoid } from "nanoid";
import type { MissionRequest } from "./api/requests/route";

const redis = Redis.fromEnv();

export async function submitRequest(data: {
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  skills: string[];
  target_dir: string;
  deadline_note: string;
}): Promise<{ id: string } | { error: string }> {
  const { title, body, priority, skills, target_dir, deadline_note } = data;

  if (!title || title.trim() === "") return { error: "title is required" };
  if (!body || body.trim() === "") return { error: "body is required" };

  const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
  const resolvedPriority = VALID_PRIORITIES.has(priority) ? priority : "medium";

  if (target_dir && !target_dir.startsWith("/")) {
    return { error: "target_dir must be an absolute path" };
  }

  const id = nanoid();
  const entry: MissionRequest = {
    id,
    title: title.trim(),
    body: body.trim(),
    priority: resolvedPriority as MissionRequest["priority"],
    skills: skills.filter((s) => typeof s === "string"),
    target_dir: target_dir.trim(),
    deadline_note: deadline_note.trim(),
    mission_slug: null,
    status: "pending",
    created_at: new Date().toISOString(),
    processed_at: null,
  };

  await redis.set(`mission_request:${id}`, JSON.stringify(entry));
  await redis.lpush("mission_requests:index", id);

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

  return { id };
}

export async function fetchRequests(status?: string): Promise<MissionRequest[]> {
  const VALID_STATUSES = new Set(["pending", "processing", "done", "rejected"]);
  if (status && !VALID_STATUSES.has(status)) return [];

  const ids = await redis.lrange<string>("mission_requests:index", 0, 49);
  if (!ids.length) return [];

  const keys = ids.map((id) => `mission_request:${id}`);
  const raws = await redis.mget<string[]>(...keys);

  let requests: MissionRequest[] = raws
    .filter((r): r is string => r !== null)
    .map((r) => (typeof r === "string" ? JSON.parse(r) : r));

  if (status) {
    requests = requests.filter((r) => r.status === status);
  }

  return requests;
}

export async function approveCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return { error: "not_found" };

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  card.status = "approved";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return { ok: true };
}

export async function denyCard(id: string): Promise<{ ok: boolean } | { error: string }> {
  const raw = await redis.get(`approval:${id}`);
  if (!raw) return { error: "not_found" };

  const card = typeof raw === "string" ? JSON.parse(raw) : raw;
  card.status = "denied";
  await redis.set(`approval:${id}`, JSON.stringify(card), { ex: 600 });

  return { ok: true };
}

export async function deleteCard(id: string): Promise<{ ok: boolean; deleted: number }> {
  const raw = await redis.get(`approval:${id}`);

  // Always remove from index to clean up orphan entries
  await redis.lrem("approval:index", 1, id);

  if (!raw) return { ok: true, deleted: 0 };

  await redis.del(`approval:${id}`);
  return { ok: true, deleted: 1 };
}

export async function bulkDeleteCards(
  filter: { ids: string[] } | { status: "pending" | "approved" | "denied" }
): Promise<{ deleted: number }> {
  // idsToRemoveFromIndex: all IDs to LREM (including orphans)
  // idsToDelete: only IDs with actual Redis entries
  let idsToRemoveFromIndex: string[];
  let idsToDelete: string[];

  if ("ids" in filter) {
    const keys = filter.ids.map((id) => `approval:${id}`);
    const raws = await redis.mget<(string | object | null)[]>(...keys);
    idsToRemoveFromIndex = filter.ids;
    idsToDelete = filter.ids.filter((_, i) => raws[i] !== null);
  } else {
    const allIds = await redis.lrange<string>("approval:index", 0, -1);
    if (!allIds.length) return { deleted: 0 };

    const keys = allIds.map((id) => `approval:${id}`);
    const raws = await redis.mget<(string | object | null)[]>(...keys);

    idsToDelete = allIds.filter((_, i) => {
      const raw = raws[i];
      if (!raw) return false;
      const card = typeof raw === "string" ? JSON.parse(raw) : raw;
      return (card as { status: string }).status === filter.status;
    });
    idsToRemoveFromIndex = idsToDelete;
  }

  if (!idsToRemoveFromIndex.length) return { deleted: 0 };

  await Promise.all([
    ...idsToDelete.map((id) => redis.del(`approval:${id}`)),
    ...idsToRemoveFromIndex.map((id) => redis.lrem("approval:index", 1, id)),
  ]);

  return { deleted: idsToDelete.length };
}

export async function cleanupOrphanCards(): Promise<{ cleaned: number }> {
  const allIds = await redis.lrange<string>("approval:index", 0, -1);
  if (!allIds.length) return { cleaned: 0 };

  const keys = allIds.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const orphanIds = allIds.filter((_, i) => raws[i] === null);
  if (!orphanIds.length) return { cleaned: 0 };

  await Promise.all(
    orphanIds.map((id) => redis.lrem("approval:index", 1, id))
  );

  return { cleaned: orphanIds.length };
}

export interface Mission {
  slug: string;
  title: string;
  status: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  assignee: string | null;
  skills: string[];
  priority: "high" | "medium" | "low";
  blocked_by: string[];
  created_at: string;
}

export async function fetchMissions(): Promise<Mission[]> {
  const slugs = await redis.lrange<string>("mission:index", 0, -1);
  if (!slugs || slugs.length === 0) return [];

  const keys = slugs.map((s) => `mission:${s}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as Mission[];
}

export async function fetchMissionTasks(slug: string): Promise<Task[]> {
  const ids = await redis.lrange<string>(`mission:${slug}:tasks:index`, 0, -1);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `mission:${slug}:tasks:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as Task[];
}

export interface ApprovalCard {
  id: string;
  tool: string;
  agent: string;
  task_title: string;
  task_id: string | null;
  priority: "high" | "medium" | "low";
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export interface AgentStatus {
  name: string;
  role: string | null;
  skills: string[];
  current_task_id: string | null;
  current_task_title: string | null;
  last_seen: string;
}

export async function fetchAgents(): Promise<AgentStatus[]> {
  const names = await redis.smembers("agent:index");
  if (!names || names.length === 0) return [];

  const keys = names.map((n) => `agent:${n}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  const agents = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as AgentStatus[];

  // Remove expired entries from index
  const expired = names.filter((_, i) => raws[i] === null);
  if (expired.length > 0) {
    await redis.srem("agent:index", ...expired);
  }

  return agents;
}

export async function fetchApprovalCards(): Promise<ApprovalCard[]> {
  const ids = await redis.lrange<string>("approval:index", 0, 99);
  if (!ids || ids.length === 0) return [];

  const keys = ids.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  return raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as ApprovalCard[];
}

export async function deleteMissionTask(slug: string, taskId: string): Promise<{ ok: boolean }> {
  await Promise.all([
    redis.del(`mission:${slug}:tasks:${taskId}`),
    redis.lrem(`mission:${slug}:tasks:index`, 1, taskId),
  ]);
  return { ok: true };
}

// ─── Verification server actions ──────────────────────────────────────────

export type VerificationVerdict = "pass" | "fail";

export interface VerificationRecord {
  task_id: string;
  mission_slug: string | null;
  mode: string;
  verdict: VerificationVerdict;
  rework_count: number;
  verified_at: string | null;
  verifier: string | null;
  received_at: string;
}

export interface ReworkCycle {
  cycle: number;
  verdict: VerificationVerdict;
  failed_checks: { name: string; status: string; duration_s?: number }[];
  verified_at: string | null;
}

export async function getVerificationUIEnabled(): Promise<boolean> {
  return process.env.CREWVIA_VERIFICATION_UI !== "disabled";
}

export async function fetchVerificationRecords(
  taskIds: string[]
): Promise<Record<string, VerificationRecord>> {
  if (!taskIds.length) return {};
  const keys = taskIds.map((id) => `verification:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);
  const result: Record<string, VerificationRecord> = {};
  taskIds.forEach((id, i) => {
    const raw = raws[i];
    if (!raw) return;
    result[id] = typeof raw === "string" ? JSON.parse(raw) : (raw as VerificationRecord);
  });
  return result;
}

export async function fetchReworkHistory(taskId: string): Promise<ReworkCycle[]> {
  const raws = await redis.lrange(`verification:history:${taskId}`, 0, 14);
  return raws
    .map((raw) => {
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        cycle: (data as { rework_count?: number }).rework_count ?? 0,
        verdict: (data as { verdict: VerificationVerdict }).verdict,
        failed_checks: ((data as { checks?: { name: string; status: string; duration_s?: number }[] }).checks ?? []).filter(
          (c) => c.status === "fail"
        ),
        verified_at: (data as { verified_at?: string | null }).verified_at ?? null,
      };
    })
    .sort((a, b) => a.cycle - b.cycle);
}

export async function fetchVerificationQueue(
  missionSlug: string
): Promise<VerificationRecord[]> {
  const taskIds = await redis.lrange(`verification:index:${missionSlug}`, 0, -1);
  if (!taskIds.length) return [];
  const keys = taskIds.map((id) => `verification:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);
  const records: VerificationRecord[] = [];
  const expired: string[] = [];
  taskIds.forEach((id, i) => {
    const raw = raws[i];
    if (!raw) { expired.push(id); return; }
    records.push(typeof raw === "string" ? JSON.parse(raw) : (raw as VerificationRecord));
  });
  if (expired.length) {
    await Promise.all(expired.map((id) => redis.lrem(`verification:index:${missionSlug}`, 1, id)));
  }
  return records;
}

export async function deleteMission(slug: string): Promise<{ ok: boolean }> {
  const taskIds = await redis.lrange<string>(`mission:${slug}:tasks:index`, 0, -1);
  await Promise.all([
    ...taskIds.map((id) => redis.del(`mission:${slug}:tasks:${id}`)),
    redis.del(`mission:${slug}:tasks:index`),
    redis.del(`mission:${slug}`),
    redis.lrem("mission:index", 1, slug),
  ]);
  return { ok: true };
}

export async function exportCards(
  status?: "pending" | "approved" | "denied"
): Promise<{ cards: ApprovalCard[]; count: number; exported_at: string }> {
  const allIds = await redis.lrange<string>("approval:index", 0, -1);
  if (!allIds.length) {
    return { cards: [], count: 0, exported_at: new Date().toISOString() };
  }

  const keys = allIds.map((id) => `approval:${id}`);
  const raws = await redis.mget<(string | object | null)[]>(...keys);

  let cards = raws
    .filter((raw): raw is string | object => raw !== null)
    .map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)) as ApprovalCard[];

  if (status) {
    cards = cards.filter((c) => c.status === status);
  }

  return { cards, count: cards.length, exported_at: new Date().toISOString() };
}
