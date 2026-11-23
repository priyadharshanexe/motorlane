// Auth on a split screen: the form on the left, a real vehicle photo framed as a key tag on the right. Inline
// validation (on leaving a field, then live), server errors under their field, password strength as a fuel gauge,
// and after sign-up a "check your inbox" indicator that blinks until the email is verified, with a resend button on
// a 60-second cooldown ring. The calls are the same allauth headless endpoints as before.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FocusEvent, FormEvent, ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, authRequest, signIn } from "../api";
import type { Vehicle } from "../api";
import { announceAuth, useSession } from "../requests";
import { Photo } from "../shared";
import { strength, validate } from "./authRules";
import { reducedMotion } from "./primitives";

const PROOF: [string, string, string][] = [
  ["live", "Live availability", "Free dates and times, cleaning included"],
  ["road", "Book on the time road", "Drag pickup and return; the price rolls"],
  ["pay", "Payments with real refunds", "Deposit back after the trip, fair cancellations"],
  ["owner", "Tools for owners", "Departures board, pickup windows, value report"],
];

/** The scene beside every account page: the highway at dusk or noon with the lane flowing, an overhead gantry with the
 *  pitch, and three real listings hanging as key tags on a rack. */
function AuthFrame({ children, unlocked = false }: { children: ReactNode; unlocked?: boolean }) {
  const rack = useQuery({ queryKey: ["vehicles", "sort=rating"], queryFn: () => api<{ results: Vehicle[] }>("vehicles/?sort=rating") });
  const tags = (rack.data?.results ?? []).filter(v => v.cover).slice(0, 3);
  return (
    <div className={`od-auth${unlocked ? " unlocked" : ""}`} data-chapter="Checkpoint · Your account">
      <section className="od-auth-panel">
        <span className="od-auth-key" aria-hidden="true"><span className="ring" /><span className="bit" /></span>
        {children}
      </section>
      <aside className="od-auth-scene" aria-label="About Motorlane">
        <svg className="od-auth-road" viewBox="0 0 800 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <polygon className="verge" points="0,420 0,190 800,190 800,420" />
          <polygon className="tarmac" points="120,420 372,190 428,190 680,420" />
          <line className="edge" x1="138" y1="420" x2="376" y2="190" /><line className="edge" x1="662" y1="420" x2="424" y2="190" />
          <line className="lane" x1="400" y1="420" x2="400" y2="190" />
          {[0, 1, 2, 3].map(i => <g key={i} className="pole" style={{ animationDelay: `${-i * 1.1}s` }}><line x1="0" y1="0" x2="0" y2="-120" /><line x1="0" y1="-120" x2="28" y2="-120" /><circle cx="28" cy="-118" r="5" /></g>)}
        </svg>
        <div className="od-auth-gantry" aria-hidden="true">
          <span className="post" /><span className="post right" />
          <span className="sign"><b>MOTORLANE</b><small>Local cars and bikes · Tamil Nadu</small><small lang="ta">வாடகை வாகனங்கள்</small></span>
        </div>
        <div className="od-auth-pitch">
          <h2>Rent a car or a bike from a local owner, and see every step of the trip.</h2>
          <ul>
            {PROOF.map(([glyph, title, text]) => (
              <li key={glyph}><span className={`od-glyph od-glyph-${glyph}`} aria-hidden="true">{glyph === "pay" ? <i>₹</i> : glyph === "owner" ? <i>A</i> : <i />}</span>
                <span><b>{title}</b><small>{text}</small></span></li>
            ))}
          </ul>
        </div>
        <div className="od-auth-rack" aria-hidden="true">
          <span className="rail" />
          {tags.map((v, i) => (
            <span className="od-rack-tag" key={v.id} style={{ "--i": i } as React.CSSProperties}>
              <span className="hook" />
              <Photo vehicle={v} />
              <span className="mono">ML·{String(v.id).padStart(4, "0")}</span>
              <b>{v.name}</b>
            </span>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, name, type = "text", autoComplete, error, onBlur, onChange, children }: {
  label: string; name: string; type?: string; autoComplete?: string; error?: string;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  return (
    <label className="od-field">
      <small>{label}</small>
      <span className="od-input-row">
        <input name={name} type={isPassword && visible ? "text" : type} autoComplete={autoComplete} required
          aria-invalid={Boolean(error)} aria-describedby={`err-${name}`} onBlur={onBlur} onChange={onChange} />
        {isPassword && <button type="button" className="od-show" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button>}
      </span>
      {children}
      <span className={`od-error-line${error ? " show" : ""}`} id={`err-${name}`}>{error}</span>
    </label>
  );
}

/** Inline validation state for a form: errors appear when you leave a field, then update live. */
function useInline() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const onBlur = (e: FocusEvent<HTMLInputElement>) => setErrors(x => ({ ...x, [e.target.name]: validate(e.target.name, e.target.value) }));
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (errors[e.target.name]) setErrors(x => ({ ...x, [e.target.name]: validate(e.target.name, e.target.value) })); };
  const all = (form: HTMLFormElement, names: string[]) => {
    const found = Object.fromEntries(names.map(n => [n, validate(n, String(new FormData(form).get(n) ?? ""))]));
    setErrors(found);
    return Object.values(found).every(v => !v);
  };
  return { errors, setErrors, onBlur, onChange, all };
}
/** Put a server message next to its field when it names one, otherwise above the button. */
const mapServerError = (message: string): Record<string, string> =>
  /password/i.test(message) ? { password: message } : /e-?mail/i.test(message) ? { email: message } : { form: message };

function FuelGauge({ value }: { value: string }) {
  const score = strength(value);
  const words = ["Empty", "Low", "Half", "Good", "Full"];
  return (
    <span className={`od-fuel s${score}`} aria-live="polite">
      <svg viewBox="-24 -22 48 26" aria-hidden="true"><path d="M-20 0 A20 20 0 0 1 20 0" className="arc" /><path d="M-20 0 A20 20 0 0 1 20 0" className="fill" pathLength={4} strokeDasharray={`${score} 4`} />
        <line x1="0" y1="0" x2="0" y2="-16" className="needle" style={{ transform: `rotate(${-90 + score * 45}deg)` }} /></svg>
      <span>Strength: {words[score]}</span>
    </span>
  );
}

const safeNext = (desired: string | null) => desired?.startsWith("/") && !desired.startsWith("//") && !desired.includes("\\") ? desired : "/bookings";

export function SignInPage() {
  const session = useSession(), cache = useQueryClient(), navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const inline = useInline();
  const [unlocked, setUnlocked] = useState(false);
  const login = useMutation({
    mutationFn: (data: FormData) => signIn(String(data.get("email")), String(data.get("password")), session.data?.csrf_token ?? ""),
    onSuccess: async () => {
      announceAuth("in");
      setUnlocked(true);  // the key tag turns and the panel says unlocked, then the page drives on
      if (!reducedMotion()) await new Promise(resolve => window.setTimeout(resolve, 650));
      await cache.invalidateQueries({ queryKey: ["session"] });
      navigate(next, { replace: true, viewTransition: !reducedMotion() });
    },
    onError: error => inline.setErrors(mapServerError(error.message)),
  });
  if (session.isPending) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;
  if (session.data?.user && !unlocked) return <Navigate to={next} replace />;
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (inline.all(event.currentTarget, ["email", "password"])) login.mutate(new FormData(event.currentTarget)); };
  return (
    <AuthFrame unlocked={unlocked}>
      <span className="od-eyebrow">{unlocked ? "Unlocked" : "Welcome back"}</span>
      <h1 tabIndex={-1}>Sign in.</h1>
      <form className="od-form" onSubmit={submit} noValidate>
        <Field label="Email" name="email" type="email" autoComplete="email" error={inline.errors.email} onBlur={inline.onBlur} onChange={inline.onChange} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" error={inline.errors.password} onBlur={inline.onBlur} onChange={inline.onChange} />
        {inline.errors.form && <p className="od-error" role="alert">{inline.errors.form}</p>}
        <button className="od-cta" disabled={login.isPending}>{unlocked ? "Unlocked ✓" : login.isPending ? "Signing in…" : "Sign in"}</button>
      </form>
      {session.data?.google_enabled && (
        <form method="post" action="/accounts/google/login/" className="od-google">
          <input type="hidden" name="csrfmiddlewaretoken" value={session.data.csrf_token} />
          <input type="hidden" name="next" value={`/app${next}`} />
          <button className="od-cta od-cta-ghost">Continue with Google</button>
        </form>
      )}
      <p className="od-auth-links"><Link to="/reset-password">Forgot your password?</Link> · <Link to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const session = useSession(), cache = useQueryClient();
  const [params] = useSearchParams();
  const inline = useInline();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const signup = useMutation({
    mutationFn: (data: Record<string, string>) => authRequest("auth/signup", data, session.data?.csrf_token ?? "", { verificationPending: true }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["session"] }),
    onError: error => inline.setErrors(mapServerError(error.message)),
  });
  if (signup.isSuccess) return <AuthFrame><VerifyPending email={email} password={password} /></AuthFrame>;
  return (
    <AuthFrame>
      <span className="od-eyebrow">Start your logbook</span>
      <h1 tabIndex={-1}>Create an account.</h1>
      <form className="od-form" noValidate onSubmit={event => {
        event.preventDefault();
        if (!inline.all(event.currentTarget, ["email", "password"])) return;
        const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
        setEmail(data.email);
        signup.mutate({ email: data.email, password: data.password });
      }}>
        <Field label="Email" name="email" type="email" autoComplete="email" error={inline.errors.email} onBlur={inline.onBlur} onChange={inline.onChange} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" error={inline.errors.password} onBlur={inline.onBlur}
          onChange={e => { setPassword(e.target.value); inline.onChange(e); }}>
          <FuelGauge value={password} />
        </Field>
        {inline.errors.form && <p className="od-error" role="alert">{inline.errors.form}</p>}
        <button className="od-cta" disabled={!session.data || signup.isPending}>{signup.isPending ? "Creating…" : "Create account"}</button>
      </form>
      <p className="od-auth-links">Already have one? <Link to={`/sign-in${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Sign in</Link></p>
    </AuthFrame>
  );
}

/** After sign-up: an indicator that blinks until the email is verified (polling the session), and a resend button
 *  with a 60-second cooldown ring. */
function VerifyPending({ email, password }: { email: string; password: string }) {
  const session = useQuery({ queryKey: ["session"], queryFn: () => api<{ user: unknown; csrf_token: string }>("session/"), refetchInterval: 5000 });
  const verified = Boolean(session.data?.user);
  const [cooldown, setCooldown] = useState(60);
  const [note, setNote] = useState("");
  useEffect(() => { if (cooldown <= 0) return; const t = window.setTimeout(() => setCooldown(c => c - 1), 1000); return () => window.clearTimeout(t); }, [cooldown]);
  const resend = useMutation({
    // Verification is by link, and allauth's resend endpoint only re-sends codes; signing in again with the details
    // just entered (kept in memory only) makes allauth send a fresh link, rate-limited to one a minute.
    mutationFn: () => authRequest("auth/login", { email, password }, session.data?.csrf_token ?? "", { verificationPending: true }),
    onSuccess: () => { setNote("Sent again. It can take a minute to arrive."); setCooldown(60); },
    onError: error => setNote(error.message),
  });
  return (
    <div className="od-verify" role="status">
      <span className={`od-verify-light${verified ? " go" : ""}`} aria-hidden="true" />
      <h1 tabIndex={-1}>{verified ? "Email verified." : "Check your inbox."}</h1>
      <p>{verified ? "You're signed in." : <>We sent a verification link to <b>{email}</b>. Open it to finish signing up; this page updates by itself.</>}</p>
      {!verified && (
        <button type="button" className="od-cta od-cta-ghost od-resend" disabled={cooldown > 0 || resend.isPending} onClick={() => resend.mutate()}>
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="track" />
            <circle cx="18" cy="18" r="15" className="ring" pathLength={60} strokeDasharray="60" style={{ strokeDashoffset: 60 - cooldown }} /></svg>
          {cooldown > 0 ? `Resend in ${cooldown}s` : resend.isPending ? "Sending…" : "Resend verification email"}
        </button>
      )}
      {note && <p className="od-fine" aria-live="polite">{note}</p>}
      {verified ? <Link className="od-cta" to="/bookings">Your trips</Link> : <p className="od-auth-links"><Link to="/sign-in">Back to sign in</Link></p>}
    </div>
  );
}

export function VerifyEmailPage() {
  const { key } = useParams();
  const session = useSession(), cache = useQueryClient();
  const verify = useMutation({
    mutationFn: () => authRequest("auth/email/verify", { key: key ?? "" }, session.data?.csrf_token ?? "", { signedOutSuccess: true }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["session"] }),
  });
  return (
    <AuthFrame>
      <span className="od-eyebrow">Last checkpoint</span>
      <h1 tabIndex={-1}>{verify.isSuccess ? "Email verified." : "Verify your email."}</h1>
      {verify.isSuccess ? <><span className="od-verify-light go" aria-hidden="true" /><p>You can now sign in.</p><Link className="od-cta" to="/sign-in">Sign in</Link></>
        : <>
          <p>Confirm the email address for your Motorlane account.</p>
          {verify.error && <p className="od-error" role="alert">{verify.error.message}</p>}
          <button type="button" className="od-cta" disabled={!session.data || verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? "Verifying…" : "Verify email"}</button>
        </>}
    </AuthFrame>
  );
}

export function ResetPage() {
  const { key } = useParams();
  const session = useSession();
  const inline = useInline();
  const [password, setPassword] = useState("");
  const request = useMutation({
    mutationFn: (data: Record<string, string>) => authRequest(key ? "auth/password/reset" : "auth/password/request", data, session.data?.csrf_token ?? "", { signedOutSuccess: Boolean(key) }),
    onError: error => inline.setErrors(mapServerError(error.message)),
  });
  return (
    <AuthFrame>
      <span className="od-eyebrow">Lost the keys?</span>
      <h1 tabIndex={-1}>{key ? "Choose a new password." : "Reset your password."}</h1>
      {request.isSuccess ? (
        <div role="status">
          <p>{key ? "Password updated. You can now sign in." : "If an account matches that email, a reset link is on its way."}</p>
          <Link className="od-cta" to="/sign-in">Sign in</Link>
        </div>
      ) : (
        <form className="od-form" noValidate onSubmit={event => {
          event.preventDefault();
          if (!inline.all(event.currentTarget, [key ? "password" : "email"])) return;
          const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
          request.mutate(key ? { key, password: data.password } : { email: data.email });
        }}>
          {key ? (
            <Field label="New password" name="password" type="password" autoComplete="new-password" error={inline.errors.password} onBlur={inline.onBlur}
              onChange={e => { setPassword(e.target.value); inline.onChange(e); }}><FuelGauge value={password} /></Field>
          ) : (
            <Field label="Email" name="email" type="email" autoComplete="email" error={inline.errors.email} onBlur={inline.onBlur} onChange={inline.onChange} />
          )}
          {inline.errors.form && <p className="od-error" role="alert">{inline.errors.form}</p>}
          <button className="od-cta" disabled={!session.data || request.isPending}>{request.isPending ? "Sending…" : key ? "Save new password" : "Send reset link"}</button>
        </form>
      )}
      <p className="od-auth-links"><Link to="/sign-in">Back to sign in</Link></p>
    </AuthFrame>
  );
}
