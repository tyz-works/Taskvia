import { auth } from "@/auth";
import { NextResponse } from "next/server";

// UI page を Google 認証(NextAuth session)で保護する。
// /api/** は matcher 対象外 — 各 Route Handler が isAuthorized() で Bearer/scope token を
// 検証する(Admiral設計判断: docs/20260720_phase0_auth_gateway_decision.md §1)。
// task_164 / 提督裁定(2026-07-28): fail-closed。TASKVIA_TOKEN の有無に関わらず
// UI page は常に NextAuth session を要求する。変更前は token 未設定時に
// NextResponse.next() で無認証素通りしており、auth.ts を fail-closed 化しても
// 「API は 401 だが UI page は素通り」という非対称が残っていた(Data 発見)。

export default auth((request) => {
  if (!request.auth) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|internal|login|_next/static|_next/image|favicon.ico).*)"],
};
