// src/proxy.ts
//
// Next.js 16 proxy (旧 middleware の後継、Node.js ランタイムで動作)。
// UI (/) と /api/cards を Basic Auth で保護する。
//
// 認証仕様:
//   - username: "admin" 固定
//   - password: 環境変数 TASKVIA_TOKEN
//   - TASKVIA_TOKEN 未設定時は無認証で通過 (オープンモード)
//     これは src/lib/auth.ts の isAuthorized() と同じ挙動で、
//     ローカル開発・スタンドアロン運用のための意図的なフォールバック。
//
// 守備範囲:
//   - "/"           — カンバン UI
//   - "/api/cards"  — UI 用の GET カード一覧 (従来は無認証だった)
//
// 他の /api/* は既存の Bearer 認証 (isAuthorized) が route handler 側で
// 守っているので、この proxy では触らない (hook スクリプトが Bearer を
// 送るので、基本認証と混ざると壊れる)。
//
// ⚠️ セキュリティメモ:
// - 基本認証は HTTPS 前提 (Vercel は常に HTTPS)
// - CVE-2025-29927 の x-middleware-subrequest 系の bypass は
//   Next.js 16 の proxy.ts 移行で対処済み
// - これは UI gateway 相当の軽量認証であり、approve/deny など副作用のある
//   API は引き続き route handler 側の Bearer 認証が sole layer として守る

const USER = "admin";
const REALM = 'Basic realm="Taskvia", charset="UTF-8"';

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export default function proxy(request: Request) {
  const token = process.env.TASKVIA_TOKEN;
  if (!token) return; // オープンモード

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }

  const colonAt = decoded.indexOf(":");
  if (colonAt < 0) return unauthorized();

  const user = decoded.slice(0, colonAt);
  const pass = decoded.slice(colonAt + 1);
  if (user !== USER || pass !== token) return unauthorized();

  // 認証 OK → handler に通す (undefined 返し = pass through)
}

export const config = {
  matcher: ["/", "/api/cards"],
};
