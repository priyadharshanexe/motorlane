// The account page: who is signed in, email addresses (add, verify, make primary, remove), the password, connected
// Google sign-in, and sign out. Everything goes through allauth's headless API with the session's CSRF token; the
// server's /accounts/ pages remain only as a fallback.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { signOut, useSession } from "../requests";
import { strength, validate } from "./authRules";
import { Odometer } from "./primitives";
import { ErrorSign } from "./states";
import { Hud, useChapters } from "./world";

type Email = { email: string; primary: boolean; verified: boolean };
type Provider = { uid: string; display: string; provider: { id: string; name: string } };

async function headless<T>(path: string, csrf: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/auth/browser/v1/${path}`, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { data?: T; errors?: { message: string }[] } | null;
  if (!response.ok) throw new Error(payload?.errors?.map(e => e.message).join(" ") || `Request failed (${response.status}).`);
  return payload?.data as T;
}

export function Account() {
  const session = useSession();
  const csrf = session.data?.csrf_token ?? "";
  const root = useRef<HTMLDivElement>(null);
  useChapters(root, [session.data?.user?.id]);
  const user = session.data?.user;
  return (
    <div className="od-page od-account" ref={root} data-chapter="Garage · Your account">
      <header className="od-page-head">
        <span className="od-eyebrow">Your account</span>
        <h1 tabIndex={-1}>{user?.name ?? "Your account"}.</h1>
        <p>Your email addresses, password and connected sign-in. Trips and listings live in <Link to="/bookings">your logbook</Link> and the <Link to="/owner">owner workspace</Link>.</p>
      </header>
      <div className="od-account-grid">
        <Emails csrf={csrf} />
        <PasswordCard csrf={csrf} />
        <Connections csrf={csrf} googleEnabled={Boolean(session.data?.google_enabled)} />
        <section className="od-card od-account-out">
          <h2>Sign out</h2>
          <p>Ends this session on this browser; any other open tabs sign out too.</p>
          <button type="button" className="od-cta od-cta-ghost" onClick={() => void signOut(csrf)}>Sign out</button>
        </section>
      </div>
      <Hud />
    </div>
  );
}

function Emails({ csrf }: { csrf: string }) {
  const cache = useQueryClient();
  const list = useQuery({ queryKey: ["account-emails"], queryFn: () => headless<Email[]>("account/email", csrf), enabled: Boolean(csrf) });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const act = useMutation({
    mutationFn: ({ method, body }: { method: string; body: Record<string, unknown> }) => headless<Email[]>("account/email", csrf, method, body),
    onSuccess: (_, { method }) => {
      setError("");
      setNote(method === "POST" ? "Added. Check that inbox for a verification link." : method === "PUT" ? "Verification link sent." : method === "PATCH" ? "Primary address changed." : "Address removed.");
      void cache.invalidateQueries({ queryKey: ["account-emails"] });
    },
    onError: e => { setNote(""); setError(e.message); },
  });
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    const problem = validate("email", email);
    if (problem) { setError(problem); return; }
    act.mutate({ method: "POST", body: { email } }, { onSuccess: () => (event.target as HTMLFormElement).reset() });
  };
  return (
    <section className="od-card od-account-emails">
      <h2>Email addresses</h2>
      <ErrorSign error={list.error} retry={() => list.refetch()} />
      <ul className="od-email-list">
        {list.data?.map(e => (
          <li key={e.email}>
            <span className="od-email-id"><b>{e.email}</b>
              <span className="od-email-badges">
                {e.primary && <span className="od-badge lane">Primary</span>}
                <span className={`od-badge ${e.verified ? "go" : "wait"}`}>{e.verified ? "✓ Verified" : "◔ Not verified"}</span>
              </span>
            </span>
            <span className="od-email-actions">
              {!e.verified && <button type="button" className="od-linkbtn" disabled={act.isPending} onClick={() => act.mutate({ method: "PUT", body: { email: e.email } })}>Resend link</button>}
              {!e.primary && e.verified && <button type="button" className="od-linkbtn" disabled={act.isPending} onClick={() => act.mutate({ method: "PATCH", body: { email: e.email, primary: true } })}>Make primary</button>}
              {!e.primary && <button type="button" className="od-linkbtn od-danger-text" disabled={act.isPending} onClick={() => act.mutate({ method: "DELETE", body: { email: e.email } })}>Remove</button>}
            </span>
          </li>
        ))}
        {list.isPending && <li className="od-skel" style={{ height: 52 }} aria-hidden="true" />}
      </ul>
      <form className="od-inline-form" onSubmit={add} noValidate>
        <label className="od-field"><small>Add an email</small>
          <input type="email" name="email" autoComplete="email" placeholder="you@example.com" />
        </label>
        <button className="od-cta" disabled={act.isPending || !csrf}>Add</button>
      </form>
      <p className="od-account-note" role="status" aria-live="polite">{note}</p>
      {error && <p className="od-error" role="alert">{error}</p>}
    </section>
  );
}

function PasswordCard({ csrf }: { csrf: string }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: (body: Record<string, string>) => headless("account/password/change", csrf, "POST", body),
    onSuccess: () => { setError(""); setPassword(""); },
    onError: e => setError(e.message),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = String(data.get("new_password") ?? "");
    const problem = validate("password", next);
    if (problem) { setError(problem); return; }
    const body: Record<string, string> = { new_password: next };
    const current = String(data.get("current_password") ?? "");
    if (current) body.current_password = current;
    change.mutate(body, { onSuccess: () => (event.target as HTMLFormElement).reset() });
  };
  const score = strength(password);
  return (
    <section className="od-card">
      <h2>Password</h2>
      <form className="od-form" onSubmit={submit} noValidate>
        <label className="od-field"><small>Current password</small>
          <span className="od-input-row"><input type={visible ? "text" : "password"} name="current_password" autoComplete="current-password" /></span>
        </label>
        <label className="od-field"><small>New password</small>
          <span className="od-input-row">
            <input type={visible ? "text" : "password"} name="new_password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="od-show" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button>
          </span>
          <span className={`od-fuel-line s${score}`} aria-live="polite">Strength: {["Empty", "Low", "Half", "Good", "Full"][score]}</span>
        </label>
        {error && <p className="od-error" role="alert">{error}</p>}
        {change.isSuccess && <p className="od-account-note" role="status">Password updated.</p>}
        <button className="od-cta" disabled={change.isPending || !csrf}>{change.isPending ? "Saving…" : "Change password"}</button>
      </form>
    </section>
  );
}

function Connections({ csrf, googleEnabled }: { csrf: string; googleEnabled: boolean }) {
  const cache = useQueryClient();
  const providers = useQuery({ queryKey: ["account-providers"], queryFn: () => headless<Provider[]>("account/providers", csrf), enabled: Boolean(csrf) && googleEnabled });
  const remove = useMutation({
    mutationFn: (p: Provider) => headless("account/providers", csrf, "DELETE", { provider: p.provider.id, account: p.uid }),
    onSettled: () => cache.invalidateQueries({ queryKey: ["account-providers"] }),
  });
  const google = providers.data?.find(p => p.provider.id === "google");
  return (
    <section className="od-card">
      <h2>Connected sign-in</h2>
      {!googleEnabled ? <p>Signing in with Google is not set up on this server; you sign in with your email and password.</p> : (
        <>
          <p className="od-provider-line">
            <span className="od-odo-chip"><Odometer value={google ? "1" : "0"} size="md" label={google ? "Google connected" : "Google not connected"} /></span>
            {google ? <>Google: <b>{google.display}</b></> : "Google is not connected."}
          </p>
          {google
            ? <button type="button" className="od-cta od-cta-ghost" disabled={remove.isPending} onClick={() => remove.mutate(google)}>Disconnect Google</button>
            : (
              <form method="post" action="/accounts/google/login/?process=connect">
                <input type="hidden" name="csrfmiddlewaretoken" value={csrf} />
                <input type="hidden" name="next" value="/app/account" />
                <button className="od-cta od-cta-ghost">Connect Google</button>
              </form>
            )}
          {remove.error && <p className="od-error" role="alert">{remove.error.message}</p>}
        </>
      )}
    </section>
  );
}
