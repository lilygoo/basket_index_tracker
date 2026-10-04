import { BasketWorkspace } from "@/components/basket-workspace";
import { LoginForm } from "@/components/login-form";
import { hasAppSession, isAppAuthConfigured } from "@/lib/auth";
import { loadWorkspace } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isSupabaseConfigured()) {
    if (!isAppAuthConfigured()) return <main className="setup-shell"><h1>Setup required</h1><p>Set BASKET_ACCESS_PASSWORD and BASKET_SESSION_SECRET before using the shared database.</p></main>;
    if (!await hasAppSession()) return <LoginForm />;
  }
  return <BasketWorkspace initialData={await loadWorkspace()} />;
}
