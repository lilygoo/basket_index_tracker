import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { todayEastern } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase";

const TICKER = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAppSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { ticker?: unknown; revision?: unknown };
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  const revision = Number(body.revision);
  if (!TICKER.test(ticker) || !Number.isInteger(revision)) return NextResponse.json({ error: "Enter a valid ticker." }, { status: 400 });
  const supabase = createAdminClient();
  const { data: price, error: priceError } = await supabase.from("daily_prices").select("ticker").eq("ticker", ticker).limit(1).maybeSingle();
  if (priceError) return NextResponse.json({ error: priceError.message }, { status: 400 });
  if (!price) {
    const { error: requestError } = await supabase.rpc("request_shared_ticker_support", { p_ticker: ticker });
    if (requestError) return NextResponse.json({ error: `Could not queue ticker support: ${requestError.message}` }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("add_basket_constituent", { p_basket_id: id, p_expected_revision: revision, p_ticker: ticker, p_effective_date: todayEastern() });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ member: data, pending: !price }, { status: 201 });
}
