import { jsonError, readSession } from "@/lib/auth";
import { readStore } from "@/lib/store";

export async function GET() {
  try {
    const session = await readSession();
    if (!session) return Response.json({ user: null });
    const store = await readStore();
    const user = store.users.find((u) => u.id === session.sub);
    if (!user) return Response.json({ user: null });
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email,
        balanceKs: user.balanceKs,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
