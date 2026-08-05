import { ensureAuthSchema, getD1 } from "@/db";
import {
  createSessionCookie,
  createSessionToken,
  sha256Hex,
  verifyAccessPassword,
} from "@/app/lib/password-auth";

export const dynamic = "force-dynamic";

const WINDOW_SECONDS = 15 * 60;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILURES = 5;

type AttemptRow = {
  window_start: number;
  failures: number;
  locked_until: number;
};

function secureRequest(request: Request) {
  return new URL(request.url).protocol === "https:";
}

async function clientKey(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return sha256Hex(forwarded);
}

export async function POST(request: Request) {
  try {
    await ensureAuthSchema();
    const now = Math.floor(Date.now() / 1000);
    const keyHash = await clientKey(request);
    const d1 = getD1();
    const attempt = await d1
      .prepare("SELECT window_start, failures, locked_until FROM auth_attempts WHERE key_hash = ?")
      .bind(keyHash)
      .first<AttemptRow>();

    if (Number(attempt?.locked_until ?? 0) > now) {
      return Response.json(
        { error: "尝试次数过多，请 15 分钟后再试" },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = (await request.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password.slice(0, 128) : "";
    const valid = password.length > 0 && await verifyAccessPassword(password);

    if (!valid) {
      const freshWindow = !attempt || now - Number(attempt.window_start) >= WINDOW_SECONDS;
      const failures = freshWindow ? 1 : Number(attempt.failures) + 1;
      const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_SECONDS : 0;

      await d1.prepare(`
        INSERT INTO auth_attempts (key_hash, window_start, failures, locked_until, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key_hash) DO UPDATE SET
          window_start = excluded.window_start,
          failures = excluded.failures,
          locked_until = excluded.locked_until,
          updated_at = CURRENT_TIMESTAMP
      `).bind(keyHash, freshWindow ? now : Number(attempt?.window_start ?? now), failures, lockedUntil).run();

      return Response.json(
        { error: lockedUntil ? "尝试次数过多，请 15 分钟后再试" : "密码不正确，请重新输入" },
        { status: lockedUntil ? 429 : 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    await d1.prepare("DELETE FROM auth_attempts WHERE key_hash = ?").bind(keyHash).run();
    const token = await createSessionToken();
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": createSessionCookie(token, secureRequest(request)),
        },
      }
    );
  } catch (error) {
    const localDebug = new URL(request.url).hostname === "localhost" && error instanceof Error
      ? { debug: error.message }
      : {};
    return Response.json(
      { error: "登录暂时不可用，请稍后重试", ...localDebug },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
