import { NextResponse } from "next/server";
import { reorderCombos } from "@/models";

// POST /api/combos/reorder — persist the dashboard's combo list order (#4322)
export async function POST(request) {
  try {
    const body = await request.json();
    const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds.filter((id) => typeof id === "string" && id.trim() !== "") : [];

    if (orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds is required" }, { status: 400 });
    }

    const updated = await reorderCombos(orderedIds);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.log("Error reordering combos:", error);
    return NextResponse.json({ error: "Failed to reorder combos" }, { status: 500 });
  }
}
