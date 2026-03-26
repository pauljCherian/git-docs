import { NextResponse } from "next/server";
import { createCommit } from "@/lib/data";
import { CreateCommitInput } from "@/lib/types";
import { requireUserId } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Omit<CreateCommitInput, "userId">;
    const revision = await createCommit({ ...body, userId });

    return NextResponse.json({ ok: true, revision });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create commit.";
    const status = message === "Unauthorized" ? 401 : 400;

    return NextResponse.json({ ok: false, message }, { status });
  }
}
