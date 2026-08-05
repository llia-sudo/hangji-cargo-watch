import { clearSessionCookie } from "@/app/lib/password-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": clearSessionCookie(secure),
      },
    }
  );
}
