import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { env } from "./env";

const COOKIE = "munshi_session";
const ADMIN_COOKIE = "munshi_admin";

function key() {
  if (!env.sessionSecret || env.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(env.sessionSecret);
}

async function sign(payload: Record<string, string>, maxAgeDays: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeDays}d`)
    .sign(key());
}

async function verify(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function startOwnerSession(shopId: string) {
  const jar = await cookies();
  jar.set(COOKIE, await sign({ shopId }, 60), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
}

export async function endOwnerSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentShopId(): Promise<string | null> {
  const payload = await verify((await cookies()).get(COOKIE)?.value);
  return typeof payload?.shopId === "string" ? payload.shopId : null;
}

export async function currentShop() {
  const id = await currentShopId();
  return id ? db.shop.findUnique({ where: { id } }) : null;
}

/** For owner pages and actions: the signed-in shop, or a redirect to sign-up. */
export async function requireShop() {
  const shop = await currentShop();
  if (!shop) redirect("/start");
  return shop;
}

export async function startAdminSession() {
  (await cookies()).set(ADMIN_COOKIE, await sign({ role: "admin" }, 1), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function isAdmin() {
  const payload = await verify((await cookies()).get(ADMIN_COOKIE)?.value);
  return payload?.role === "admin";
}
