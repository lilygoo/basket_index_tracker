import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { name?: unknown; weightingMethod?: unknown; revision?: unknown };
  const supabase = createAdminClient();
  const { data: current, error: readError } = await supabase.from("baskets").select("name,weighting_method").eq("id", id).single();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 404 });
  const name = String(body.name ?? current.name).trim();
  const weighting = body.weightingMethod === undefined ? current.weighting_method : body.weightingMethod;
  const revision = Number(body.revision);
  if (!name || name.length > 80 || !["equal", "market_cap"].includes(String(weighting)) || !Number.isInteger(revision)) return NextResponse.json({ error: "Invalid basket update." }, { status: 400 });
  const { data, error } = await supabase.rpc("update_basket_details", { p_basket_id: id, p_expected_revision: revision, p_name: name, p_weighting_method: weighting });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A basket with that name already exists." : error.message }, { status: ["40001", "23505"].includes(error.code) ? 409 : 400 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (!Number.isInteger(revision)) return NextResponse.json({ error: "Missing basket revision." }, { status: 400 });
  const { error } = await createAdminClient().rpc("delete_basket", { p_basket_id: id, p_expected_revision: revision });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ ok: true });
}
