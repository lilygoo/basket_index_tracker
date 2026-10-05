import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { unsupportedTickers, type SecurityUniverseStatus } from "@/lib/security-universe";
import { createAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { name?: unknown; weightingMethod?: unknown; tickers?: unknown };
  const name = String(body.name ?? "").trim();
  const weighting = body.weightingMethod === "market_cap" ? "market_cap" : "equal";
  const tickers = Array.isArray(body.tickers)
    ? [...new Set(body.tickers.map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean))]
    : [];
  if (!name || name.length > 80) return NextResponse.json({ error: "Enter a basket name up to 80 characters." }, { status: 400 });
  if (!tickers.length || tickers.some((ticker) => !/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(ticker))) {
    return NextResponse.json({ error: "Add at least one valid ticker." }, { status: 400 });
  }
  const supabase = createAdminClient();
  const [{ data: firstPrice, error: priceError }, { data: universeRows, error: universeError }] = await Promise.all([
    supabase.from("daily_prices").select("price_date").order("price_date").limit(1).maybeSingle(),
    supabase.from("security_universe").select("ticker,active,support_status").in("ticker", tickers),
  ]);
  if (priceError) return NextResponse.json({ error: priceError.message }, { status: 400 });
  if (universeError) return NextResponse.json({ error: universeError.message }, { status: 400 });
  const pending = unsupportedTickers(tickers, (universeRows ?? []) as SecurityUniverseStatus[]);
  const inceptionDate = firstPrice?.price_date ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("create_basket_with_constituents", {
    p_name: name, p_weighting_method: weighting, p_tickers: tickers, p_inception_date: inceptionDate,
  });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A basket with that name already exists." : error.message }, { status: error.code === "23505" ? 409 : 400 });

  const created = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: created?.id, pending }, { status: 201 });
}
