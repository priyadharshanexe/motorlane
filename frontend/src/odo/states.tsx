// Empty and error states as road signs drawn on screen, each with one useful action, and the session guard for
// the redesigned signed-in pages. No illustrations of people, no emoji.
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../api";
import { useSession } from "../requests";

type Sign = "end" | "diversion" | "noentry" | "maintenance";

const SIGNS: Record<Sign, ReactNode> = {
  // Road ends: a red-and-white barrier board.
  end: <><rect x="10" y="34" width="100" height="26" rx="3" className="board" />
    {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M${14 + i * 20} 58 l14 -22 h8 l-14 22 z`} className="stripe" />)}
    <rect x="22" y="60" width="6" height="40" className="post" /><rect x="92" y="60" width="6" height="40" className="post" /></>,
  // Diversion: a yellow board with a bent arrow.
  diversion: <><rect x="18" y="12" width="84" height="70" rx="6" className="yellow" />
    <path d="M44 70 V44 a10 10 0 0 1 10 -10 h18 v-8 l14 14 -14 14 v-8 H56 v24 z" className="ink" />
    <rect x="57" y="82" width="6" height="22" className="post" /></>,
  // No entry: a red disc with a white bar.
  noentry: <><circle cx="60" cy="48" r="38" className="red" /><rect x="34" y="42" width="52" height="12" rx="2" className="white" />
    <rect x="57" y="86" width="6" height="18" className="post" /></>,
  // Closed for maintenance: a red-bordered triangle with a spanner.
  maintenance: <><path d="M60 10 L104 84 H16 Z" className="tri" />
    <path d="M52 64 l16 -16 a8 8 0 1 1 6 6 l-16 16 a4 4 0 0 1 -6 -6 z" className="ink" />
    <rect x="57" y="84" width="6" height="20" className="post" /></>,
};

export function RoadSign({ kind, title, children, action }: { kind: Sign; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`od-roadsign od-roadsign-${kind}`} role="status">
      <svg viewBox="0 0 120 106" aria-hidden="true">{SIGNS[kind]}</svg>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** "Diversion": an error with a retry. */
export function ErrorSign({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return <RoadSign kind="diversion" title="Diversion ahead." action={retry && <button type="button" className="od-cta od-cta-ghost" onClick={retry}>Try again</button>}>{message}</RoadSign>;
}

/** Redirects to sign-in (and back afterwards) when there is no session; reserves the viewport while it checks. */
/** A vehicle that is archived, paused or was never there answers 404: say so in the site's own words instead of
 * showing the server's sentence ("No Vehicle matches the given query."). Anything else is a real error. */
export function VehicleMissing({ error, retry }: { error: unknown; retry?: () => void }) {
  if (error instanceof ApiError && error.status === 404) return <div className="od-page"><RoadSign kind="end" title="This ride isn't on the road."
    action={<Link className="od-cta" to="/vehicles">See every ride</Link>}>The owner may have paused or archived it, or the link may be mistyped.</RoadSign></div>;
  return <div className="od-page"><ErrorSign error={error} retry={retry} /></div>;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <div className="od-page-loading" style={{ minHeight: "100vh" }} />;
  if (session.isError) return <div className="od-page"><ErrorSign error={session.error} retry={() => session.refetch()} /></div>;
  if (!session.data.user) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function NoEntry() {
  return <RoadSign kind="noentry" title="No entry." action={<Link className="od-cta" to="/sign-in">Sign in</Link>}>Sign in to see this page.</RoadSign>;
}

/** Any /app URL that matches no page: a "Road ends" sign with the way back. */
export function NotFound() {
  return (
    <div className="od-page" data-chapter="Dead end">
      <RoadSign kind="end" title="This road doesn't go anywhere."
        action={<Link className="od-cta" to="/" viewTransition>Back to the start</Link>}>
        The page you asked for isn't here. It may have moved, or the link may be mistyped.
      </RoadSign>
    </div>
  );
}
