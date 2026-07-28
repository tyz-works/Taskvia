// src/lib/auth.ts
export function isAuthorized(req: Request): boolean {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  // task_164 / 提督裁定(2026-07-28): fail-closed。token 未設定・空白時は全 API を 401 にする。
  // 変更前は `return true`(open mode)であり、31 箇所のガードが無認証で全許可されていた。
  // Phase 0 DoD「token 未設定の production profile」要件の実装側の担保はこの 1 行である。
  if (!token) return false;
  const auth = req.headers.get("Authorization");
  return auth === `Bearer ${token}`;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
