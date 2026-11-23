// The "world" every Odometer page drives through, shared by the real pages and /app/lab:
//   <Backdrop>   tarmac grain, margin lane lines and kerbs that scroll with distance driven, far road signs and
//                kilometre posts (margins only), and a headlight sweep when you accelerate hard;
//   <Hud>        a fixed GPS strip: the current chapter, a speed needle and the km odometer;
//   useChapters  every [data-chapter] section announces itself to the HUD as it crosses the middle of the screen,
//                and all triggers re-measure when the page height changes (late data and images).
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { drive, gsap, MAX_KMH, onDrive, ScrollTrigger } from "./drive";
import { reducedMotion, TripMeter } from "./primitives";
import "./world.css";

export function useChapters(root: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // The whole document, not just the page: the toll-gate footer belongs to the shell but is the last chapter.
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(document.querySelectorAll("[data-chapter]")).forEach(section => {
        ScrollTrigger.create({ trigger: section, start: "top 55%", end: "bottom 55%",
          onToggle: self => { if (self.isActive) drive.chapter = section.dataset.chapter ?? ""; } });
      });
    });
    const first = document.querySelector<HTMLElement>("[data-chapter]");
    if (first) drive.chapter = first.dataset.chapter ?? "";
    let timer = 0, lastHeight = 0;
    const observer = new ResizeObserver(entries => {
      const height = Math.round(entries[0].contentRect.height);
      if (height === lastHeight) return;
      lastHeight = height;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); ctx.revert(); };
  }, deps);  // eslint-disable-line react-hooks/exhaustive-deps
}

export function Backdrop() {
  const near = useRef<HTMLDivElement>(null), far = useRef<HTMLDivElement>(null), sweep = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let sweeping = false;
    return onDrive(() => {
      const travelled = drive.km * 9000;  // the margins scroll with distance driven, not just page position
      if (near.current) near.current.style.transform = `translate3d(0, ${(-(travelled % 160)).toFixed(1)}px, 0)`;
      if (far.current) far.current.style.transform = `translate3d(0, ${(-((travelled * 0.35) % 1400)).toFixed(1)}px, 0)`;
      if (!sweeping && drive.throttle > 0.55 && sweep.current) {
        sweeping = true;
        gsap.fromTo(sweep.current, { xPercent: -60, opacity: 0 }, {
          xPercent: 160, opacity: 1, duration: 1.1, ease: "power2.inOut",
          onComplete: () => { gsap.set(sweep.current, { opacity: 0 }); window.setTimeout(() => { sweeping = false; }, 1600); },
        });
      }
    });
  }, []);
  return (
    <div className="od-backdrop" aria-hidden="true">
      <div className="od-grain" />
      <div className="od-far" ref={far}>
        {Array.from({ length: 8 }, (_, i) => (
          <div className={`od-far-item ${i % 2 ? "right" : "left"}`} key={i} style={{ top: `${i * 175 + 60}px` }}>
            {i % 3 === 0 ? <span className="od-kmpost mono">{120 + i * 4}<small>km</small></span>
              : i % 3 === 1 ? <span className="od-sign od-sign-curve" /> : <span className="od-sign od-sign-speed mono">60</span>}
          </div>
        ))}
      </div>
      <div className="od-near" ref={near}>
        <span className="od-margin-lane left" /><span className="od-margin-lane right" />
        <span className="od-kerb left" /><span className="od-kerb right" />
      </div>
      <div className="od-sweep" ref={sweep} />
    </div>
  );
}

/** The HUD. On a page with a hero (which has its own speedometer), it stays away until the hero has mostly
 *  scrolled off; elsewhere it is always shown. */
export function Hud({ hero = "" }: { hero?: string }) {
  const chapter = useRef<HTMLSpanElement>(null), speed = useRef<HTMLSpanElement>(null), needle = useRef<SVGLineElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = hero ? document.querySelector(hero) : null;
    if (!target) { hud.current?.classList.remove("away"); return; }
    const trigger = ScrollTrigger.create({ trigger: target, start: "top bottom", end: "bottom 55%",  // starts before scroll 0
      onToggle: self => hud.current?.classList.toggle("away", self.isActive) });
    hud.current?.classList.toggle("away", window.scrollY < trigger.end);
    return () => trigger.kill();
  }, [hero]);
  useEffect(() => {
    let shown = "", shownSpeed = -1;
    return onDrive(() => {
      if (chapter.current && shown !== drive.chapter) { shown = drive.chapter; chapter.current.textContent = shown; }
      const rounded = Math.round(drive.kmh);
      if (speed.current && rounded !== shownSpeed) { shownSpeed = rounded; speed.current.textContent = String(rounded).padStart(3, "0"); }
      if (needle.current) needle.current.style.transform = `rotate(${(-120 + (drive.kmh / MAX_KMH) * 240).toFixed(1)}deg)`;
    });
  }, []);
  return (
    <div className="od-hud away" ref={hud} role="status" aria-label="Trip readout">
      <span className="od-hud-pin" aria-hidden="true" />
      <span className="od-hud-chapter" ref={chapter}>Start</span>
      <span className="od-hud-gauge" aria-hidden="true">
        <svg viewBox="-20 -20 40 40"><path d="M-14 8 A16 16 0 1 1 14 8" className="arc" /><line ref={needle} x1="0" y1="0" x2="0" y2="-13" className="needle" /></svg>
      </span>
      <span className="od-hud-speed mono"><span ref={speed}>000</span> km/h</span>
      <span className="od-hud-odo"><TripMeter digits={5} /> <small>km</small></span>
    </div>
  );
}
