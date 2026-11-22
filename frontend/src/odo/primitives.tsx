// Motion primitives shared by the redesigned pages and the /lab prototype: the odometer, the frame-driven trip
// meter, run-once reveals, and the device/motion checks. Everything animates transform or opacity only.
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { drive, onDrive, ScrollTrigger } from "./drive";

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The 3D road only where it will run smoothly; everyone else gets the 2D road. */
export const canRun3D = () => {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return !reducedMotion() && (navigator.hardwareConcurrency ?? 8) > 4 && !nav.connection?.saveData
    && !!document.createElement("canvas").getContext("webgl2");
};

/** True while scrolling (and briefly after), so hover effects don't fire when content slides under a still cursor. */
export const scrolling = { active: false, timer: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("scroll", () => {
    scrolling.active = true;
    window.clearTimeout(scrolling.timer);
    scrolling.timer = window.setTimeout(() => { scrolling.active = false; }, 180);
  }, { passive: true });
}

/** Odometer: each digit is a column of 0-9 that rolls to the target digit (driven by React value changes). */
export function Odometer({ value, size = "lg", label }: { value: string; size?: "lg" | "md"; label?: string }) {
  return (
    <span className={`odo odo-${size}`} aria-label={label ?? value} role="img">
      {value.split("").map((char, index) => /\d/.test(char) ? (
        <span className="odo-wheel" key={index} aria-hidden="true">
          <span className="odo-strip" style={{ "--digit": Number(char) } as CSSProperties}>
            {"0123456789".split("").map(d => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span className="odo-sep" key={index} aria-hidden="true">{char}</span>)}
    </span>
  );
}

/** A trip meter driven every frame from `drive.km`. Wheels sit exactly on a digit at rest; only the tenths wheel
 *  rolls (in the last fifth of each tenth) and higher wheels roll only on a 9 -> 0 carry, like a real odometer.
 *  Offsets are whole device pixels of a wheel height that lands on pixel boundaries at 100/125/150% scaling. */
export function TripMeter({ digits = 5, className = "" }: { digits?: number; className?: string }) {
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const last = useRef<number[]>([]);
  useEffect(() => onDrive(() => {
    const tenths = drive.km * 10;
    const dpr = window.devicePixelRatio || 1;
    let carry = 0;
    for (let i = digits - 1; i >= 0; i--) {
      const strip = strips.current[i];
      const height = strip?.parentElement?.clientHeight ?? 0;
      const digit = Math.floor(tenths / 10 ** (digits - 1 - i)) % 10;
      let roll: number;
      if (i === digits - 1) {
        const t = Math.min(1, Math.max(0, ((tenths % 1) - 0.8) / 0.2));
        roll = t * t * (3 - 2 * t);
      } else roll = carry;
      carry = digit === 9 ? roll : 0;
      const y = -Math.round((digit + roll) * height * dpr) / dpr;
      if (strip && height && last.current[i] !== y) { last.current[i] = y; strip.style.transform = `translate3d(0, ${y}px, 0)`; }
    }
  }), [digits]);
  return (
    <span className={`tripmeter ${className}`} aria-hidden="true">
      {Array.from({ length: digits }, (_, i) => (
        <span className={`tripmeter-wheel${i === digits - 1 ? " tenths" : ""}`} key={i}>
          <span className="tripmeter-strip" ref={el => { strips.current[i] = el; }}>
            {"01234567890".split("").map((d, k) => <span key={k}>{d}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Run once when the element first comes into view (immediately under reduced motion). */
export function useOnce<T extends Element>(onEnter: () => void, start = "top 75%") {
  const ref = useRef<T>(null);
  const callback = useRef(onEnter);
  useEffect(() => { callback.current = onEnter; });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const trigger = ScrollTrigger.create({ trigger: ref.current, start, once: true, onEnter: () => callback.current() });
    return () => trigger.kill();
  }, [start]);
  return ref;
}
