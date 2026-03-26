import { NextResponse } from "next/server";
import { listRevisions } from "@/lib/data";
import { requireUserId } from "@/lib/auth-helpers";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");
    const branchId = searchParams.get("branchId");

    if (!documentId || !branchId) {
      return NextResponse.json(
        { ok: false, message: "documentId and branchId are required." },
        { status: 400 },
      );
    }

    const revisions = await listRevisions(documentId, branchId, userId);

    return NextResponse.json({ ok: true, revisions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load revisions.";
    const status = message === "Unauthorized" ? 401 : 400;

    return NextResponse.json({ ok: false, message }, { status });
  }
}
