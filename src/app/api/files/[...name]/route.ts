import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/files/:name — serves locally stored dev images (STORAGE_DRIVER=local).
 * Public on purpose: the official Instagram API must be able to fetch the
 * image_url from Meta's servers at publish time. Production uses Cloudinary.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string[] }> }
) {
  const { name } = await params;
  const safe = path.basename((name || []).join("/"));
  if (!/^[\w.-]+\.jpe?g$/i.test(safe)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const dir = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || "data/uploads");
  try {
    const buf = await fs.readFile(path.join(dir, safe));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
