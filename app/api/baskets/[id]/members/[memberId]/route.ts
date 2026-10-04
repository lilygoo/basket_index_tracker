import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { todayEastern } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, memberId } = await params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (!Number.isInteger(revision)) return NextResponse.json({ error: "Missing basket revision." }, { status: 400 });
  const { error } = await createAdminClient().rpc("remove_basket_constituent", { p_basket_id: id, p_member_id: memberId, p_expected_revision: revision, p_effective_date: todayEastern() });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ ok: true });
}
