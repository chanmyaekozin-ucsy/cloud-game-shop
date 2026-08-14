export async function GET() {
  return Response.json({ ok: true, service: "cloud-game-shop-web" }, { status: 200 });
}
