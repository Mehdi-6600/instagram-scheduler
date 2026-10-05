import { destroySession } from "@/lib/auth";
import { errorResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    await destroySession();
    return jsonOk({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
