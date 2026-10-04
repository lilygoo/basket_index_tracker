"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (response.ok) window.location.reload();
    else { setError("That password was not accepted."); setPending(false); }
  }
  return <main className="login-shell"><form className="login-panel" onSubmit={submit}><LockKeyhole size={22}/><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Basket Index Tracker</h1><p>Enter the shared application password. Vercel Authentication should also remain enabled for every deployment.</p><label><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus/></label>{error && <div className="login-error">{error}</div>}<button disabled={pending}>{pending ? "Checking…" : "Open workspace"}</button></form></main>;
}
