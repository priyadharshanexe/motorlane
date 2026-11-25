// The account page, a settings page: a section list beside one column of sections (profile, emails, password,
// connected Google sign-in, sign out). Everything goes through allauth's headless API with the session's CSRF token;
// the server's /accounts/ pages remain only as a fallback. A Google-only account has no password: it gets "Set a
// password" without a current-password field, and can't disconnect Google until it has one.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { signOut, useSession } from "../requests";
import { strength, validate } from "./authRules";
import { ErrorSign } from "./states";
import { Hud, useChapters } from "./world";

type Email = { email: string; primary: boolean; verified: boolean };
type Provider = { uid: string; display: string; provider: { id: string; name: string } };
type AuthUser = { display?: string; email?: string; has_usable_password?: boolean };

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

const SECTIONS = [["profile", "Profile"], ["emails", "Emails"], ["password", "Password"], ["connected", "Connected sign-in"], ["sign-out", "Sign out"]] as const;

// One settings section: its title and explanation on the left, its controls on the right (stacked on phones).
function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section className="od-set" id={id} aria-labelledby={`${id}-title`}>
      <div className="od-set-head"><h2 id={`${id}-title`}>{title}</h2><p>{lead}</p></div>
      <div className="od-set-body">{children}</div>
    </section>
  );
}

export function Account() {
  const session = useSession();
  const csrf = session.data?.csrf_token ?? "";
  const root = useRef<HTMLDivElement>(null);
  useChapters(root, [session.data?.user?.id]);
  const user = session.data?.user;
  // allauth knows whether this account has a password (a Google-only account does not)
  const auth = useQuery({ queryKey: ["account-auth"], queryFn: () => headless<{ user: AuthUser }>("auth/session", csrf), enabled: Boolean(csrf) });
  const hasPassword = auth.data?.user?.has_usable_password ?? true;
  const signsInWith = !auth.data ? "…" : hasPassword ? "Email and password" : "Google only";
  return (
    <div className="od-page od-account" ref={root} data-chapter="Garage · Your account">
      <header className="od-page-head">
        <span className="od-eyebrow">Your account</span>
        <h1 tabIndex={-1}>{user?.name ?? "Your account"}.</h1>
        <p>Your email addresses, password and connected sign-in. Trips and listings live in <Link to="/bookings">your logbook</Link> and the <Link to="/owner">owner workspace</Link>.</p>
      </header>
      <div className="od-account-layout">
        <nav className="od-set-nav" aria-label="Account sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={event => { event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>
          ))}
        </nav>
        <div className="od-set-list">
          <Section id="profile" title="Profile" lead="How you appear to owners and renters on Motorlane.">
            <dl className="od-set-facts">
              <div><dt>Name</dt><dd>{user?.name ?? "…"}</dd></div>
              <div><dt>Signs in with</dt><dd>{signsInWith}</dd></div>
            </dl>
          </Section>
          <Section id="emails" title="Emails" lead="Where booking updates and receipts go. The primary address is the one you sign in with.">
            <Emails csrf={csrf} />
          </Section>
          <Section id="password" title={hasPassword ? "Password" : "Set a password"}
            lead={hasPassword ? "Change the password you sign in with." : "You sign in with Google. Add a password to sign in with your email as well."}>
            <PasswordForm csrf={csrf} hasPassword={hasPassword} />
          </Section>
          <Section id="connected" title="Connected sign-in" lead="Sign in with your Google account instead of a password.">
            <Connections csrf={csrf} googleEnabled={Boolean(session.data?.google_enabled)} hasPassword={hasPassword} />
          </Section>
          <Section id="sign-out" title="Sign out" lead="Ends this session on this browser; any other open tabs sign out too.">
            <button type="button" className="od-cta od-cta-ghost od-set-action" onClick={() => void signOut(csrf)}>Sign out</button>
          </Section>
        </div>
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
    <>
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
      {note && <p className="od-account-note" role="status" aria-live="polite">{note}</p>}
      {error && <p className="od-error" role="alert">{error}</p>}
    </>
  );
}

function PasswordForm({ csrf, hasPassword }: { csrf: string; hasPassword: boolean }) {
  const cache = useQueryClient();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: (body: Record<string, string>) => headless("account/password/change", csrf, "POST", body),
    onSuccess: () => { setError(""); setPassword(""); void cache.invalidateQueries({ queryKey: ["account-auth"] }); },
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
    if (hasPassword && current) body.current_password = current;
    change.mutate(body, { onSuccess: () => (event.target as HTMLFormElement).reset() });
  };
  const score = strength(password);
  return (
    <form className="od-form od-set-form" onSubmit={submit} noValidate>
      {hasPassword && (
        <label className="od-field"><small>Current password</small>
          <span className="od-input-row"><input type={visible ? "text" : "password"} name="current_password" autoComplete="current-password" /></span>
        </label>
      )}
      <label className="od-field"><small>New password</small>
        <span className="od-input-row">
          <input type={visible ? "text" : "password"} name="new_password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
          <button type="button" className="od-show" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button>
        </span>
        <span className={`od-fuel-line s${score}`} aria-live="polite">Strength: {["Empty", "Low", "Half", "Good", "Full"][score]}</span>
      </label>
      {error && <p className="od-error" role="alert">{error}</p>}
      {change.isSuccess && <p className="od-account-note" role="status">{hasPassword ? "Password updated." : "Password set."}</p>}
      <button className="od-cta od-set-action" disabled={change.isPending || !csrf}>{change.isPending ? "Saving…" : hasPassword ? "Change password" : "Set password"}</button>
    </form>
  );
}

function Connections({ csrf, googleEnabled, hasPassword }: { csrf: string; googleEnabled: boolean; hasPassword: boolean }) {
  const cache = useQueryClient();
  const providers = useQuery({ queryKey: ["account-providers"], queryFn: () => headless<Provider[]>("account/providers", csrf), enabled: Boolean(csrf) && googleEnabled });
  const remove = useMutation({
    mutationFn: (p: Provider) => headless("account/providers", csrf, "DELETE", { provider: p.provider.id, account: p.uid }),
    onSettled: () => cache.invalidateQueries({ queryKey: ["account-providers"] }),
  });
  if (!googleEnabled) return <p className="od-set-muted">Signing in with Google is not set up on this server; you sign in with your email and password.</p>;
  const google = providers.data?.find(p => p.provider.id === "google");
  return (
    <>
      <div className="od-provider">
        <svg className="od-provider-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span className="od-provider-id"><b>Google</b><span>{providers.isPending ? "…" : google ? google.display : "Not connected"}</span></span>
        {google && <span className="od-badge go">Connected</span>}
        <span className="od-provider-act">
          {google
            ? <button type="button" className="od-linkbtn od-danger-text" disabled={remove.isPending || !hasPassword} onClick={() => remove.mutate(google)}>{remove.isPending ? "Disconnecting…" : "Disconnect"}</button>
            : !providers.isPending && (
              <form method="post" action="/accounts/google/login/?process=connect">
                <input type="hidden" name="csrfmiddlewaretoken" value={csrf} />
                <input type="hidden" name="next" value="/app/account" />
                <button className="od-cta od-cta-ghost od-set-action">Connect</button>
              </form>
            )}
        </span>
      </div>
      {google && !hasPassword && <p className="od-set-muted">Google is your only way in. Set a password above before disconnecting it.</p>}
      {remove.error && <p className="od-error" role="alert">{remove.error.message}</p>}
    </>
  );
}
