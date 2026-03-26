import { NextResponse } from "next/server";
import { saveWorkingState } from "@/lib/data";
import { SaveWorkingStateInput } from "@/lib/types";
import { requireUserId } from "@/lib/auth-helpers";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Omit<SaveWorkingStateInput, "userId">;
    const pageState = await saveWorkingState({ ...body, userId });

    return NextResponse.json({ ok: true, pageState });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync working state.";
    const status = message === "Unauthorized" ? 401 : 400;

    return NextResponse.json({ ok: false, message }, { status });
  }
}
