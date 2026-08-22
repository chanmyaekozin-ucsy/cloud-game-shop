import { clearSessionCookie } from "@/lib/auth";
import { bumpTokenVersion } from "@/lib/store";

export async function POST() {
  await clearSessionCookie();
  try {
    // Invalidate every JWT issued for this user so a stolen cookie cannot be
    // replayed after logout. The next login re-issues with the new version.
    const session = await (await import("@/lib/auth")).readSession();
    if (session) {
      await bumpTokenVersion(session.sub);
    }
  } catch {
    // Cookie already cleared; nothing more to do.
  }
  return Response.json({ ok: true });
}
