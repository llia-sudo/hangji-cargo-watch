import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "hangji_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type RuntimeSecrets = {
  ACCESS_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
};

function runtimeSecrets() {
  const values = env as unknown as RuntimeSecrets;
  if (!values.ACCESS_PASSWORD_HASH || !values.SESSION_SECRET) {
    throw new Error("Password access is not configured.");
  }
  return {
    passwordHash: values.ACCESS_PASSWORD_HASH.toLowerCase(),
    sessionSecret: values.SESSION_SECRET,
  };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyAccessPassword(password: string) {
  const actual = await sha256Hex(password);
  return timingSafeEqual(actual, runtimeSecrets().passwordHash);
}

export async function createSessionToken() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = await hmac(payload, runtimeSecrets().sessionSecret);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await hmac(payload, runtimeSecrets().sessionSecret);
  return timingSafeEqual(parts[2], expected);
}

function cookieValue(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(valueParts.join("="));
  }
  return undefined;
}

export async function hasValidPageSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function hasValidRequestSession(request: Request) {
  return verifySessionToken(cookieValue(request));
}

export function createSessionCookie(token: string, secure: boolean) {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(secure: boolean) {
  const secureFlag = secure ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly${secureFlag}; SameSite=Strict; Max-Age=0`;
}
