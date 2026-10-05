import { getSessionUser } from "@/lib/auth";
import { jsonOk } from "@/lib/http";
import { isMockInstagram, storageDriver } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return jsonOk({ authenticated: false }, { status: 401 });
  }
  return jsonOk({
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.name },
    mockInstagram: isMockInstagram(),
    storageDriver: storageDriver(),
  });
}
