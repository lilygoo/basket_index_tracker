import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "basket_index_session";

export function isAppAuthConfigured() {
  return Boolean(process.env.BASKET_ACCESS_PASSWORD && process.env.BASKET_SESSION_SECRET);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function passwordMatches(value: string) {
  const expected = process.env.BASKET_ACCESS_PASSWORD;
  return Boolean(expected && safeEqual(value, expected));
}

export function sessionToken() {
  const password = process.env.BASKET_ACCESS_PASSWORD;
  const secret = process.env.BASKET_SESSION_SECRET;
  if (!password || !secret) throw new Error("Application authentication is not configured.");
  return createHmac("sha256", secret).update(`basket-index-v1:${password}`).digest("hex");
}

export async function hasAppSession() {
  if (!isAppAuthConfigured()) return false;
  const value = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return safeEqual(value, sessionToken());
}

export async function requireAppSession() {
  return hasAppSession();
}
