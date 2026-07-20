import { auth } from "@/auth";
import { NextResponse } from "next/server";

// UI page を Google 認証(NextAuth session)で保護する。
// /api/** は matcher 対象外 — 各 Route Handler が isAuthorized() で Bearer/scope token を
// 検証する(Admiral設計判断: docs/20260720_phase0_auth_gateway_decision.md §1)。
// TASKVIA_TOKEN 未設定時は無認証で通過 (オープンモード)。

export default auth((request) => {
  const token = (process.env.TASKVIA_TOKEN ?? "").trim();
  if (!token) return NextResponse.next(); // オープンモード

  if (!request.auth) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
