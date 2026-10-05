import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth";
import { todayEastern } from "@/lib/date";
import { unsupportedTickers, type SecurityUniverseStatus } from "@/lib/security-universe";
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
  const { data: universeRows, error: universeError } = await supabase.from("security_universe").select("ticker,active,support_status").eq("ticker", ticker);
  if (universeError) return NextResponse.json({ error: universeError.message }, { status: 400 });
  const pending = unsupportedTickers([ticker], (universeRows ?? []) as SecurityUniverseStatus[]).length > 0;
  const { data, error } = await supabase.rpc("add_basket_constituent", { p_basket_id: id, p_expected_revision: revision, p_ticker: ticker, p_effective_date: todayEastern() });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "40001" ? 409 : 400 });
  return NextResponse.json({ member: data, pending }, { status: 201 });
}
