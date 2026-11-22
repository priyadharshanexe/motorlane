// The redesigned public shell (home, catalog, vehicle detail): one scroll system (Lenis -> ScrollTrigger), the
// Night/Daytime theme, a header that floats over the scene, and the toll-gate footer. The workspace pages keep
// the existing Layout until their slice is redesigned.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/public-sans";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { useSession } from "../requests";
import RouteErrorBoundary from "../RouteErrorBoundary";
import { gsap, getLenis, ScrollTrigger, startDrive, stopDrive } from "./drive";
import { reducedMotion } from "./primitives";
import { ThemeProvider, useTheme } from "./theme";
import "./odo.css";

export function OdoLayout({ children }: { children: ReactNode }) {
  return <ThemeProvider><Shell>{children}</Shell></ThemeProvider>;
}

/** The Lane M: two lane lines converge into the M, its middle stroke a dashed centre line that draws in. */
export function LaneMark() {
  return (
    <svg className="od-lanemark" viewBox="0 0 40 40" aria-hidden="true">
      <path className="od-lanemark-m" d="M6 34 L6 6 L20 22 L34 6 L34 34" />
      <path className="od-lanemark-lane" d="M20 25 V34" />
    </svg>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { pathname, search, key } = useLocation();
  const session = useSession();
  const header = useRef<HTMLElement>(null), menu = useRef<HTMLDetailsElement>(null);
  const firstRoute = useRef(true);

  useEffect(() => { startDrive(); return () => stopDrive(); }, []);

  // A new page starts at the top, triggers re-measure once it has laid out, and focus moves to its heading
  // (announced politely) for keyboard and screen-reader users. The very first load keeps the browser's focus.
  useLayoutEffect(() => {
    getLenis()?.scrollTo(0, { immediate: true, force: true });
    if (!getLenis()) window.scrollTo(0, 0);
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 60);
    if (!firstRoute.current) document.querySelector<HTMLElement>("#main h1")?.focus({ preventScroll: true });
    firstRoute.current = false;
    return () => window.clearTimeout(id);
  }, [pathname]);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [pathname, search]);

  // The header is transparent over the hero and gains a backing once the page scrolls under it.
  useLayoutEffect(() => {
    const trigger = ScrollTrigger.create({ start: 80, onToggle: self => header.current?.classList.toggle("solid", self.isActive) });
    return () => trigger.kill();
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current?.open && !event.composedPath().includes(menu.current)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, []);

  return (
    <div className="od-app" data-theme={theme} data-motion={reducedMotion() ? "reduced" : "full"}>
      <a className="od-skip" href="#main">Skip to content</a>
      <header className="od-header" ref={header}>
        <Link className="od-brand" to="/" viewTransition><LaneMark /> <span>MOTORLANE</span></Link>
        <nav className="od-nav" aria-label="Main navigation">
          <NavLink end to="/" viewTransition>Discover</NavLink>
          <NavLink to="/vehicles?type=Car" viewTransition className={() => search.includes("type=Car") && pathname === "/vehicles" ? "active" : ""}>Cars</NavLink>
          <NavLink to="/vehicles?type=Bike" viewTransition className={() => search.includes("type=Bike") && pathname === "/vehicles" ? "active" : ""}>Bikes</NavLink>
        </nav>
        <div className="od-header-actions">
          <Link className="od-host" to="/owner/fleet?edit=new">List your vehicle</Link>
          <button type="button" className="od-theme" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "daytime" : "night"} colours`}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><span className="od-theme-label">{theme === "dark" ? "Day" : "Night"}</span>
          </button>
          <details ref={menu} className="od-menu" key={key}
            onKeyDown={event => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}>
            <summary aria-label="Open navigation menu"><span className="od-burger" aria-hidden="true"><i /><i /><i /></span><span className="od-menu-label">Menu</span></summary>
            <div className="od-menu-sheet">
              <Link to="/vehicles">Explore vehicles</Link>
              <Link to="/favorites">Saved vehicles</Link>
              <Link to="/dashboard">Renter dashboard</Link>
              <Link to="/owner">Owner workspace</Link>
              <Link to="/account">Settings</Link>
              {session.data?.user ? (
                <form method="post" action="/accounts/logout/">
                  <input type="hidden" name="csrfmiddlewaretoken" value={session.data.csrf_token} />
                  <input type="hidden" name="next" value="/app/" />
                  <button className="od-menu-signout">Sign out</button>
                </form>
              ) : <Link to="/sign-in">Sign in / Create account</Link>}
            </div>
          </details>
        </div>
      </header>
      <main id="main" className="od-main">
        <RouteErrorBoundary key={key}>{children}</RouteErrorBoundary>
      </main>
      <TollGate />
    </div>
  );
}

/** The page ends at a toll gate: the barrier lifts as you roll up to it (scrubbed) and the light turns green. */
function TollGate() {
  const section = useRef<HTMLElement>(null), arm = useRef<SVGGElement>(null), light = useRef<SVGCircleElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (reducedMotion()) { gsap.set(arm.current, { rotation: -78, svgOrigin: "60 120" }); light.current?.classList.add("go"); return; }
    const ctx = gsap.context(() => {
      gsap.fromTo(arm.current, { rotation: 0, svgOrigin: "60 120" }, {
        rotation: -78, svgOrigin: "60 120", ease: "none",
        scrollTrigger: { trigger: section.current, start: "top 85%", end: "top 35%", scrub: 0.5,
          onUpdate: self => light.current?.classList.toggle("go", self.progress > 0.92) },
      });
    }, section);
    return () => ctx.revert();
  }, [pathname]);
  return (
    <footer className="od-footer" ref={section}>
      <svg className="od-gate" viewBox="0 -240 900 460" aria-hidden="true">
        <rect x="0" y="176" width="900" height="44" className="od-gate-road" />
        <g className="od-gate-check">{Array.from({ length: 30 }, (_, i) => <rect key={i} x={i * 30} y={i % 2 ? 176 : 186} width="30" height="10" />)}</g>
        <rect x="40" y="96" width="40" height="80" className="od-gate-post" />
        <circle ref={light} cx="60" cy="86" r="9" className="od-gate-light" />
        <g ref={arm}>
          <rect x="60" y="112" width="400" height="16" rx="3" className="od-gate-arm" />
          {Array.from({ length: 5 }, (_, i) => <rect key={i} x={90 + i * 76} y="112" width="38" height="16" className="od-gate-stripe" />)}
        </g>
      </svg>
      <div className="od-footer-grid">
        <div className="od-footer-brand">
          <Link className="od-brand" to="/"><LaneMark /> <span>MOTORLANE</span></Link>
          <p>Cars and bikes from local owners across Tamil Nadu.</p>
          <Link className="od-cta" to="/owner/fleet?edit=new">Become a host</Link>
        </div>
        <nav aria-label="Explore rentals">
          <strong>Explore rentals</strong>
          <Link to="/vehicles">All vehicles</Link>
          <Link to="/vehicles?type=Car">Browse cars</Link>
          <Link to="/vehicles?type=Bike">Browse bikes</Link>
        </nav>
        <nav aria-label="Vehicle owners">
          <strong>Vehicle owners</strong>
          <Link to="/owner/fleet?edit=new">List your vehicle</Link>
          <Link to="/owner">Owner workspace</Link>
        </nav>
      </div>
    </footer>
  );
}
