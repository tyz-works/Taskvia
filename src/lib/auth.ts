// src/lib/auth.ts
export function isAuthorized(req: Request): boolean {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  if (!token) return true; // トークン未設定時はオープン
  const auth = req.headers.get("Authorization");
  return auth === `Bearer ${token}`;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
