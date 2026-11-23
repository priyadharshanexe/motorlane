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
import { drive, getLenis, MAX_KMH, onDrive, onScreen, ScrollTrigger, startDrive, stopDrive } from "./drive";
import { reducedMotion } from "./primitives";
import { ThemeProvider, useTheme } from "./theme";
import { Backdrop } from "./world";
import "./odo.css";
import "./slice2.css";
import "./slice3.css";

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
      <Backdrop />
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
        {/* keyed by path, not location.key: changing filters must not remount the page (focus, FLIP reflow) */}
        <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>
      </main>
      <TollGate />
    </div>
  );
}

/** The end of the drive: a toll plaza. As you scroll down to it (scrubbed, so scrolling back reverses it) a car
 *  drives in along the road and stops at the barrier, the arm lifts, the booth light turns green, and the car drives
 *  through and away. The centre line flows at the shared drive speed; the backdrop's kerbs carry on either side. */
function TollGate() {
  const section = useRef<HTMLElement>(null), arm = useRef<SVGGElement>(null), light = useRef<SVGCircleElement>(null);
  const car = useRef<SVGGElement>(null), lane = useRef<SVGPathElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const ease = (t: number) => 1 - (1 - t) ** 3;
    const place = (progress: number) => {
      // 0-0.45 drive up and stop at the barrier; 0.45-0.75 the arm lifts; 0.75-1 drive through and off.
      let x: number, lift: number;
      if (progress < 0.45) { x = -160 + ease(progress / 0.45) * (588 + 160); lift = 0; }
      else if (progress < 0.75) { x = 588; lift = ease((progress - 0.45) / 0.3); }
      else { x = 588 + ((progress - 0.75) / 0.25) ** 2 * 1100; lift = 1; }
      car.current?.setAttribute("transform", `translate(${x.toFixed(1)} 0)`);
      arm.current?.setAttribute("transform", `rotate(${(lift * 75).toFixed(1)} 740 205)`);  // clears the canopy
      light.current?.classList.toggle("go", lift > 0.9);
    };
    if (reducedMotion()) { place(0.75); return; }
    place(0);
    const trigger = ScrollTrigger.create({ trigger: section.current, start: "top 95%", end: "bottom bottom", scrub: 0.5, onUpdate: self => place(self.progress) });
    let flow = 0;
    const visible = onScreen(section.current);
    const stopFlow = onDrive(dt => {
      if (!visible.flag.on) return;
      flow = (flow - (drive.kmh / MAX_KMH) * 300 * dt) % 60;
      lane.current?.setAttribute("stroke-dashoffset", flow.toFixed(1));
    });
    return () => { trigger.kill(); stopFlow(); visible.stop(); };
  }, [pathname]);
  return (
    <footer className="od-footer" ref={section} data-chapter="Toll gate · Finish">
      <svg className="od-gate" viewBox="0 0 1400 310" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        {/* road, centre line and kerb */}
        <rect x="-400" y="236" width="2200" height="56" className="od-gate-road" />
        <path ref={lane} className="od-gate-lane" d="M-400 264 H1800" strokeDasharray="30 30" />
        <g className="od-gate-kerb">{Array.from({ length: 56 }, (_, i) => <rect key={i} x={-400 + i * 40} y="292" width="40" height="10" className={i % 2 ? "w" : "r"} />)}</g>
        {/* the plaza: canopy on two pillars, with a fascia sign */}
        <rect x="540" y="50" width="16" height="186" className="od-gate-pillar" />
        <rect x="984" y="50" width="16" height="186" className="od-gate-pillar" />
        <rect x="500" y="8" width="540" height="38" rx="3" className="od-gate-canopy" />
        <rect x="500" y="44" width="540" height="6" className="od-gate-fascia" />
        <text x="770" y="33" textAnchor="middle" className="od-gate-sign">TOLL PLAZA · சுங்கச்சாவடி</text>
        {/* the booth with its light */}
        <rect x="770" y="140" width="110" height="96" rx="4" className="od-gate-booth" />
        <rect x="784" y="154" width="82" height="40" rx="2" className="od-gate-window" />
        <rect x="758" y="112" width="20" height="40" rx="4" className="od-gate-lamp" />
        <circle ref={light} cx="768" cy="124" r="6" className="od-gate-light" />
        {/* the car, nose to the right */}
        <g ref={car} className="od-gate-car">
          <rect x="-112" y="206" width="112" height="30" rx="9" className="body" />
          <path d="M-88 206 L-74 184 H-34 L-18 206 Z" className="cabin" />
          <rect x="-8" y="214" width="8" height="8" rx="2" className="lamp" />
          <circle cx="-86" cy="238" r="11" className="wheel" /><circle cx="-26" cy="238" r="11" className="wheel" />
        </g>
        {/* the barrier: post at the booth, arm across the lane towards the oncoming car */}
        <rect x="732" y="196" width="16" height="40" className="od-gate-post" />
        <g ref={arm}>
          <rect x="600" y="200" width="144" height="10" rx="3" className="od-gate-arm" />
          {Array.from({ length: 3 }, (_, i) => <rect key={i} x={610 + i * 44} y="200" width="22" height="10" className="od-gate-stripe" />)}
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
