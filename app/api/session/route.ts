import { NextResponse } from "next/server";
import { passwordMatches, SESSION_COOKIE, sessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { password?: unknown };
  if (!passwordMatches(String(body.password ?? ""))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
