import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { name?: unknown; weightingMethod?: unknown };
  const name = String(body.name ?? "New Basket").trim();
  const weighting = body.weightingMethod === "market_cap" ? "market_cap" : "equal";
  if (!name || name.length > 80) return NextResponse.json({ error: "Enter a basket name up to 80 characters." }, { status: 400 });
  const supabase = createAdminClient();
  const { data: firstPrice, error: priceError } = await supabase.from("daily_prices").select("price_date").order("price_date").limit(1).maybeSingle();
  if (priceError) return NextResponse.json({ error: priceError.message }, { status: 400 });
  const { data, error } = await supabase.from("baskets").insert({ name, weighting_method: weighting, inception_date: firstPrice?.price_date ?? new Date().toISOString().slice(0, 10) }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
