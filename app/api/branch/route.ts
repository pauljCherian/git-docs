import { NextResponse } from "next/server";
import { createBranch } from "@/lib/data";
import { CreateBranchInput } from "@/lib/types";
import { requireUserId } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Omit<CreateBranchInput, "userId">;
    const branch = await createBranch({ ...body, userId });

    return NextResponse.json({ ok: true, branch });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create branch.";
    const status = message === "Unauthorized" ? 401 : 400;

    return NextResponse.json({ ok: false, message }, { status });
  }
}
