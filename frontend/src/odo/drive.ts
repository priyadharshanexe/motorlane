// One scroll system and one notion of "speed" for the whole lab.
//
// Lenis owns scrolling and drives GSAP ScrollTrigger through gsap.ticker (no CSS smooth scroll,
// no second rAF loop). Every scroll-linked effect reads `drive`: the road, the speedometer, the
// headline stretch, the background parallax and the HUD all move from the same numbers, so they
// can never disagree. Nothing here touches React state.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

export const drive = {
  /** 0 when idle, up to 1 at full speed (scaled from Lenis's scroll velocity). */
  throttle: 0,
  /** Road speed in "km/h" for the HUD: crawls at IDLE_KMH, tops out at MAX_KMH. */
  kmh: 0,
  /** Kilometres driven since the page opened (scroll distance plus the idle crawl). */
  km: 0,
  /** Current chapter, for the HUD's GPS readout. */
  chapter: "Start",
  reduced: false,
};

export const IDLE_KMH = 18;
export const MAX_KMH = 160;

type Listener = (dt: number) => void;
const listeners = new Set<Listener>();
/** Called every frame from gsap.ticker with the frame time in seconds. */
export function onDrive(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lenis: Lenis | null = null;
let users = 0;

export function startDrive() {
  users += 1;
  if (users > 1) return lenis;
  drive.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!drive.reduced) {
    lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, syncTouch: false });
    lenis.on("scroll", ScrollTrigger.update);
  }
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

/** The active Lenis instance (null under reduced motion or before startDrive). */
export const getLenis = () => lenis;

export function stopDrive() {
  users -= 1;
  if (users > 0) return;
  gsap.ticker.remove(tick);
  lenis?.destroy();
  lenis = null;
}

let throttleTarget = 0;
function tick(time: number, deltaMs: number) {
  lenis?.raf(time * 1000);
  const dt = Math.min(0.05, deltaMs / 1000);
  // Scroll velocity (px per frame from Lenis) becomes a throttle. Pressing is quick, releasing is slow,
  // like a real accelerator: the road surges when you scroll and coasts back to a crawl when you stop.
  const velocity = Math.abs(lenis?.velocity ?? 0);
  throttleTarget = Math.min(1, velocity / 28);
  const rate = throttleTarget > drive.throttle ? 9 : 1.6;
  drive.throttle += (throttleTarget - drive.throttle) * (1 - Math.exp(-dt * rate));
  drive.kmh = drive.reduced ? 0 : IDLE_KMH + (MAX_KMH - IDLE_KMH) * drive.throttle;
  drive.km += (drive.kmh / 3600) * dt * 40;  // time-lapse: the trip should visibly add up while you scroll
  listeners.forEach(listener => listener(dt));
}

export { gsap, ScrollTrigger };
