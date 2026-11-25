// The hero's signature 3D moment: a Tamil Nadu highway seen from the driver's seat, built only from primitives
// (no downloaded models). Everything near the road streams past at the shared `drive` speed, so scenery adds
// parallax and makes speed visible:
//   near:   lane dashes, one steel W-beam guard rail per side with reflector studs, milestones (white, yellow top, real catalog cities),
//           a guard rail in stretches;
//   middle: coconut palms, roadside trees, streetlights (pools of light at night), paddy-field rows;
//   far:    a low Western Ghats ridge and a temple gopuram on the horizon, drifting slowly; a moon at night.
// Night is dark mode, day is light mode. Instanced meshes, recycled positions, DPR capped, the frame loop stops
// when the hero is offscreen, and this file is lazy-loaded so it never delays the first paint.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import "@fontsource/noto-sans-tamil/700.css";
import "@fontsource-variable/archivo/wdth.css";
import { drive } from "./drive";

const NEAR = 4;  // camera z; objects recycle from here back to NEAR - period
/** z for item i of a recycled row: moves towards the camera as `travel` grows and wraps every `period`. */
const zOf = (i: number, spacing: number, period: number, travel: number) =>
  NEAR - ((((i * spacing - travel) % period) + period) % period);

type Palette = ReturnType<typeof palette>;
const palette = (light: boolean) => light ? {
  skyTop: "#5FAEDF", skyMid: "#A8D5EC", skyLow: "#F7E8C9", road: "#76726C", shoulder: "#D9CFBC", edge: "#FFFFFF", lane: "#FFC531", post: "#F2EEE4",
  eye: "#D9761A", field: "#8BBE4B", paddy: "#6EA637", trunk: "#8A6440", leaf: "#3E9140", leaf2: "#6DB548", tree: "#4C9B3C",
  hill: "#7FA69A", hill2: "#A3C2BC", gopuram: "#C9A577", rail: "#D5D8DC", lamp: "#D8D4CB", pool: "#000000",
  shadow: 0.32, poolOpacity: 0, moon: false, haze: "#F7E8C9",
} : {
  skyTop: "#0E1013", skyMid: "#15171A", skyLow: "#2A251D", road: "#1C1F23", shoulder: "#23262A", edge: "#D8D4CB", lane: "#FFC531", post: "#3A3F46",
  eye: "#FFB020", field: "#141E17", paddy: "#1A2A1F", trunk: "#2E2820", leaf: "#183022", tree: "#15291C",
  hill: "#22231F", hill2: "#2B2A24", gopuram: "#332F27", rail: "#4A4F56", lamp: "#FFE6A8", pool: "#FFC970",
  shadow: 0, poolOpacity: 0.16, moon: true, leaf2: "#1F3A28", haze: "#2A251D",
};

/** An open, four-sided beam (a rectangular frustum) from the lamp head down to the road: the top matches the
 * head (1.4 x 0.22), the bottom matches the pool (3.6 x 2.8); height 5.1, centred on y = 0 like a cone. */
const beamGeometry = (() => {
  const h = 2.55, top = [0.7, 0.11], bottom = [1.8, 1.4];
  const corners = (y: number, [x, z]: number[]) => [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]];
  const t = corners(h, top), b = corners(-h, bottom), pos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pos.push(...b[i], ...t[j], ...b[j], ...b[i], ...t[i], ...t[j]);  // wound outwards: drawn front-side only, one even sheet of light
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
})();

/** A soft round blob (light pools at night, contact shadows by day). */
function radialTexture() {
  // 256px with a gentle falloff and mipmaps, so the edge stays soft even when seen at a grazing angle.
  const canvas = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  [[0, 1], [0.35, 0.7], [0.65, 0.25], [0.85, 0.06], [1, 0]].forEach(([at, alpha]) => gradient.addColorStop(at, `rgba(255,255,255,${alpha})`));
  g.fillStyle = gradient;
  g.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

function skyTexture(colors: Palette) {
  const canvas = Object.assign(document.createElement("canvas"), { width: 4, height: 128 });
  const g = canvas.getContext("2d")!;
  const gradient = g.createLinearGradient(0, 0, 0, 128);
  // A clear blue overhead that softens and warms towards the horizon.
  gradient.addColorStop(0, colors.skyTop);
  gradient.addColorStop(0.55, colors.skyMid);
  gradient.addColorStop(0.88, colors.skyLow);
  gradient.addColorStop(1, colors.skyLow);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** An Indian highway milestone face: yellow cap, white body, stencilled place and kilometres. */
function milestoneTexture(place: string, km: number) {
  const canvas = Object.assign(document.createElement("canvas"), { width: 128, height: 176 });
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#F2EFE8";
  g.fillRect(0, 0, 128, 176);
  g.fillStyle = "#FFC531";
  g.beginPath();
  g.moveTo(0, 64); g.lineTo(0, 46); g.arc(64, 46, 64, Math.PI, 0); g.lineTo(128, 64); g.closePath();
  g.fill();
  g.fillStyle = "#16181B";
  g.textAlign = "center";
  const name = place.toUpperCase();
  g.font = "bold 22px 'JetBrains Mono', monospace";
  const width = g.measureText(name).width;
  g.save();
  g.translate(64, 98);
  if (width > 116) g.scale(116 / width, 1);
  g.fillText(name, 0, 0);
  g.restore();
  g.font = "bold 44px 'JetBrains Mono', monospace";
  g.fillText(String(km), 64, 152);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A flat silhouette from an outline (x, y pairs), standing on y = 0. */
function silhouette(points: number[]) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0], 0);
  for (let i = 0; i < points.length; i += 2) shape.lineTo(points[i], points[i + 1]);
  shape.lineTo(points[points.length - 2], 0);
  return new THREE.ShapeGeometry(shape);
}

// A low ridge (Western Ghats) one tile wide; two tiles side by side wrap seamlessly.
const RIDGE_W = 260;
const ridge = (seed: number) => {
  const points: number[] = [];
  for (let x = 0; x <= RIDGE_W; x += 10) {
    const y = 7 + Math.sin((x / RIDGE_W) * Math.PI * 4 + seed) * 3 + Math.sin((x / RIDGE_W) * Math.PI * 10 + seed * 2) * 1.4;
    points.push(x - RIDGE_W / 2, y);
  }
  return silhouette(points);
};
// A stepped temple gopuram: tiers narrowing upwards, a barrel roof and finials.
const gopuram = () => {
  const tiers = 7, base = 9, height = 15;
  const left: number[] = [], right: number[] = [];
  for (let i = 0; i <= tiers; i++) {
    const half = base / 2 - i * 0.5, y = (i / tiers) * height;
    left.push(-half, y, -half + 0.3, y);
    right.unshift(half - 0.3, y, half, y);
  }
  return silhouette([...left, -1.4, height + 1.6, -0.6, height + 2.2, 0, height + 3, 0.6, height + 2.2, 1.4, height + 1.6, ...right]);
};

// ----- Tamil Nadu highway direction signs -----------------------------------------------------------------------
// Green boards with a white border, Tamil above English, white arrows and distances, drawn on a canvas with the
// self-hosted Noto Sans Tamil and Archivo. One overhead gantry the camera drives under, and one smaller roadside
// board on a single post; both recycle like the rest of the scenery and swap destinations while far away.
const TAMIL: Record<string, string> = {
  Chennai: "சென்னை", Coimbatore: "கோயம்புத்தூர்", Madurai: "மதுரை", Tiruchirappalli: "திருச்சிராப்பள்ளி",
  Trichy: "திருச்சி", Salem: "சேலம்", Erode: "ஈரோடு", Tirunelveli: "திருநெல்வேலி", Vellore: "வேலூர்",
  Thanjavur: "தஞ்சாவூர்", Kanyakumari: "கன்னியாகுமரி", Tiruppur: "திருப்பூர்", Thoothukudi: "தூத்துக்குடி",
  Dindigul: "திண்டுக்கல்", Hosur: "ஓசூர்", Kanchipuram: "காஞ்சிபுரம்", Puducherry: "புதுச்சேரி", Ooty: "ஊட்டி",
  // The page's own chapters, for the "next on this road" gantry.
  Catalog: "வாகனப் பட்டியல்", "How it works": "செயல்படும் விதம்", "Your trip": "உங்கள் பயணம்",
};
const SIGN_FALLBACK = ["Madurai", "Coimbatore", "Tiruchirappalli", "Salem", "Chennai", "Erode", "Tirunelveli", "Vellore"];
const SIGN_GREEN = "#0B6B3A";
type Arrow = "left" | "up" | "right";

function drawArrow(g: CanvasRenderingContext2D, x: number, y: number, size: number, dir: Arrow) {
  g.save();
  g.translate(x, y);
  g.rotate(dir === "left" ? -Math.PI / 2 : dir === "right" ? Math.PI / 2 : 0);
  const w = size * 0.18;
  g.beginPath();
  g.moveTo(0, -size / 2); g.lineTo(size * 0.42, -size * 0.06); g.lineTo(w, -size * 0.06); g.lineTo(w, size / 2);
  g.lineTo(-w, size / 2); g.lineTo(-w, -size * 0.06); g.lineTo(-size * 0.42, -size * 0.06); g.closePath();
  g.fill();
  g.restore();
}

/** One sign as two textures: the board (green, border, text) and a "retroreflective" layer with only the white
 *  parts on transparent, which glows at night. Destinations are [English name, km, arrow]. */
function signTextures(width: number, height: number, header: string, destinations: [string, number, Arrow][]) {
  const make = (withBoard: boolean) => {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const g = canvas.getContext("2d")!;
    if (withBoard) { g.fillStyle = SIGN_GREEN; g.fillRect(0, 0, width, height); }
    const inset = height * 0.045, radius = height * 0.06;
    g.strokeStyle = "#FFFFFF"; g.lineWidth = height * 0.022;
    g.beginPath(); g.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius); g.stroke();
    g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    if (header) {
      g.font = `700 ${Math.round(height * 0.075)}px "Archivo Variable", "Archivo", sans-serif`;
      g.fillText(header, width / 2, height * 0.16);
      g.fillRect(width * 0.08, height * 0.2, width * 0.84, height * 0.008);
    }
    const columns = destinations.length, colWidth = (width - inset * 4) / columns, top = header ? height * 0.24 : height * 0.08;
    destinations.forEach(([name, km, arrow], i) => {
      const cx = inset * 2 + colWidth * (i + 0.5), span = colWidth * 0.86;
      const fit = (text: string, font: string, y: number) => {
        g.font = font;
        const scale = Math.min(1, span / Math.max(1, g.measureText(text).width));
        g.save(); g.translate(cx, y); g.scale(scale, 1); g.fillText(text, 0, 0); g.restore();
      };
      const unit = height - top;
      drawArrow(g, cx, top + unit * 0.2, unit * 0.26, arrow);
      fit(TAMIL[name] ?? name, `700 ${Math.round(unit * 0.15)}px "Noto Sans Tamil", sans-serif`, top + unit * 0.53);
      fit(name, `700 ${Math.round(unit * 0.14)}px "Archivo Variable", "Archivo", sans-serif`, top + unit * 0.72);
      fit(`${km} km`, `600 ${Math.round(unit * 0.11)}px "Archivo Variable", "Archivo", sans-serif`, top + unit * 0.88);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
  };
  return { board: make(true), glow: make(false) };
}

const GANTRY_PERIOD = 152, BOARD_PERIOD = 152;
const DASHES = 38, DASH_SPACING = 4;  // tight enough that a dash is always in the bottom of the frame
const MILESTONES = 5, MILE_SPACING = 32;
const RAIL_POSTS = 76, RAIL_POST_SPACING = 4, RAIL_X = 5.05;  // posts every 2 units per side
const PALMS = 36, PALM_SPACING = 8.5, FRONDS = 5;
const TREES = 24, TREE_SPACING = 13;
const LIGHTS = 20, LIGHT_SPACING = 16;
const ROWS = 96, ROW_SPACING = 3.2;
const FAR = 150;  // camera far plane; every recycled loop is at least this long

/** Standing scenery shares one light by day (sun from the side plus soft ambient); at night it stays flat. */
function Lit({ color, light }: { color: string; light: boolean }) {
  return light ? <meshLambertMaterial color={color} /> : <meshBasicMaterial color={color} />;
}

function Scene({ light, places, lite, onSlow }: { light: boolean; places: string[]; lite: boolean; onSlow: () => void }) {
  const colors = useMemo(() => palette(light), [light]);
  const { camera } = useThree();
  const temp = useMemo(() => new THREE.Object3D(), []);
  const blob = useMemo(radialTexture, []);
  const sky = useMemo(() => skyTexture(colors), [colors]);
  const ridgeNear = useMemo(() => ridge(0.6), []), ridgeFar = useMemo(() => ridge(2.1), []);
  const temple = useMemo(gopuram, []);
  const key = places.join("|");
  const milestones = useMemo(() => Array.from({ length: MILESTONES }, (_, i) => {
    const place = key.split("|")[i % places.length];
    return milestoneTexture(place, 12 + ((place.length * 37 + i * 53) % 180));
  }), [key, places.length]);
  useEffect(() => () => milestones.forEach(t => t.dispose()), [milestones]);
  useEffect(() => () => sky.dispose(), [sky]);

  const dashes = useRef<THREE.InstancedMesh>(null);
  const railPosts = useRef<THREE.InstancedMesh>(null), studs = useRef<THREE.InstancedMesh>(null), trunks = useRef<THREE.InstancedMesh>(null), fronds = useRef<THREE.InstancedMesh>(null);
  const canopies = useRef<THREE.InstancedMesh>(null), treeTrunks = useRef<THREE.InstancedMesh>(null), poles = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<THREE.InstancedMesh>(null), pools = useRef<THREE.InstancedMesh>(null), shadows = useRef<THREE.InstancedMesh>(null);
  const rows = useRef<THREE.InstancedMesh>(null), cones = useRef<THREE.InstancedMesh>(null);
  const all = [cones, dashes, railPosts, studs, trunks, fronds, canopies, treeTrunks, poles, lamps, pools, shadows, rows];
  const mileGroup = useRef<THREE.Group>(null), ridgeA = useRef<THREE.Group>(null), ridgeB = useRef<THREE.Group>(null);
  const templeMesh = useRef<THREE.Mesh>(null);
  const travel = useRef(0);

  // Direction signs: wait for the sign fonts (so the canvas never draws a fallback font), then build a few
  // destination sets from the catalog's real cities (with known Tamil names) and rotate through them.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      document.fonts.load('700 64px "Noto Sans Tamil"', "சென்னை"),
      document.fonts.load('700 64px "Archivo Variable"'),
    ]).catch(() => undefined).finally(() => { if (alive) setFontsReady(true); });
    return () => { alive = false; };
  }, []);
  const signKey = places.filter(p => TAMIL[p]).join("|");
  const signs = useMemo(() => {
    if (!fontsReady || new URLSearchParams(location.search).has("nosigns")) return null;  // ?nosigns: A/B performance checks
    const towns = [...new Set([...signKey.split("|").filter(Boolean), ...SIGN_FALLBACK])].slice(0, 9);
    const km = (town: string, i: number) => 18 + ((town.length * 41 + i * 67) % 260);
    // The first gantry you meet signs the page itself: the chapters ahead, straight on.
    const chapters = signTextures(1536, 560, "NEXT ON THIS ROAD", [["Catalog", 1, "up"], ["How it works", 2, "up"], ["Your trip", 3, "up"]]);
    const towns3 = [0, 1, 2].map(set => {
      const pick = [0, 1, 2].map(i => towns[(set * 3 + i) % towns.length]);
      return signTextures(1536, 560, "NH 44 · TAMIL NADU", [[pick[0], km(pick[0], 0), "left"], [pick[1], km(pick[1], 1), "up"], [pick[2], km(pick[2], 2), "right"]]);
    });
    const gantries = [chapters, ...towns3];
    const boards = towns.slice(0, 4).map((town, i) => signTextures(640, 400, "", [[town, km(town, i + 5), i % 2 ? "up" : "right"]]));
    return { gantries, boards };
  }, [fontsReady, signKey]);
  const { gl } = useThree();
  useEffect(() => {
    if (!signs) return;
    // Upload every sign texture to the GPU once, now, so swapping destinations later costs nothing mid-drive.
    signs.gantries.concat(signs.boards).forEach(t => { gl.initTexture(t.board); gl.initTexture(t.glow); });
    return () => signs.gantries.concat(signs.boards).forEach(t => { t.board.dispose(); t.glow.dispose(); });
  }, [signs, gl]);
  const gantry = useRef<THREE.Group>(null), board = useRef<THREE.Group>(null);
  const gantryFace = useRef<THREE.Mesh>(null), gantryGlow = useRef<THREE.Mesh>(null);
  const boardFace = useRef<THREE.Mesh>(null), boardGlow = useRef<THREE.Mesh>(null);
  const signCycle = useRef({ gantryZ: 0, gantryN: 0, boardZ: 0, boardN: 0 });
  // r3f aims the default camera at the origin, pitching it ~17 degrees down: the horizon rides high, the road fills
  // the frame and near dash gaps look huge. Look level down the road instead, with the horizon near mid-frame.
  useEffect(() => { camera.lookAt(0, 1.0, -40); }, [camera]);
  useEffect(() => {  // ?debug exposes the scene to the pop-in/pop-out check in walkthrough/popcheck.js
    if (!new URLSearchParams(location.search).has("debug")) return;
    (window as unknown as { __labRoad: unknown }).__labRoad = { camera, meshes: { railPosts, trunks, canopies, poles, lamps, pools, cones, rows, dashes }, stones: mileGroup, gantry, board };
  });
  useEffect(() => {  // palm fronds in two greens, alternating, so crowns read as leaves rather than one flat colour
    const mesh = fronds.current; if (!mesh) return;
    const a = new THREE.Color(colors.leaf), b = new THREE.Color(colors.leaf2);
    for (let i = 0; i < PALMS * FRONDS; i++) mesh.setColorAt(i, i % 2 ? a : b);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [colors]);
  const budget = useRef({ frames: 0, total: 0 });
  // Lite mode only lowers the canvas resolution (set on <Canvas>). Thinning the scenery gave no measurable gain on
  // slow CPUs and made objects jump or vanish at the moment it switched on, so every object stays where it is.
  const k = 1;

  const set = (mesh: THREE.InstancedMesh | null, index: number, x: number, y: number, z: number,
    sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    if (!mesh) return;
    temp.position.set(x, y, z);
    temp.rotation.set(rx, ry, rz);
    temp.scale.set(sx, sy, sz);
    temp.updateMatrix();
    mesh.setMatrixAt(index, temp.matrix);
  };

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    // Measure the real frame budget once (frames 30-120): if it runs slower than ~50 fps, drop to lite mode.
    const b = budget.current;
    if (!lite && b.frames < 120) {
      b.frames++;
      if (b.frames > 30) b.total += delta;
      if (b.frames === 120 && b.total / 90 > 0.02) onSlow();
    }
    const throttle = drive.throttle;
    travel.current += (4 + throttle * 70) * dt;  // road units per second: a crawl at idle, a rush at full throttle
    const s = travel.current;
    // Dashes lengthen into streaks with speed but never close the gap (2.2 long, 6 apart: at most ~3.7 long).
    const stretch = 1 + throttle * 0.6;  // 1.8 long, 4 apart: at most ~2.9 long, so a gap always shows

    for (let i = 0; i < DASHES; i++) {
      // Dashes run right under the camera and recycle once behind it; the capped stretch keeps the nearest one a dash.
      set(dashes.current, i, 0, 0.011, zOf(i, DASH_SPACING, DASHES * DASH_SPACING, s), 1, 1, stretch);
    }

    // Everything recycles only once it is behind the camera (z > NEAR wraps to the far end), and every loop is
    // longer than the visible road (the far plane is FAR), so nothing pops in or out inside the frame. Things
    // grow in over the last stretch before the horizon, where the haze is already thick.
    const grow = (z: number) => Math.min(1, Math.max(0.001, (z + FAR - 2) / 24));

    // Steel guard-rail posts with reflector studs, both sides; the W-beam itself is one continuous rail (below).
    for (let i = 0; i < RAIL_POSTS; i++) {
      const side = i % 2 ? 1 : -1, z = zOf(i, RAIL_POST_SPACING / 2, (RAIL_POSTS * RAIL_POST_SPACING) / 2, s);
      set(railPosts.current, i, side * RAIL_X, 0.33, z);
      set(studs.current, i, side * (RAIL_X - 0.07), 0.62, z);
    }
    // Milestones on the right, beyond the rail.
    mileGroup.current?.children.forEach((stone, i) => {
      stone.position.z = zOf(i, MILE_SPACING, MILESTONES * MILE_SPACING, s + 19);
      stone.scale.setScalar(grow(stone.position.z));
    });
    // Coconut palms: a leaning trunk and drooping fronds radiating from the crown.
    for (let i = 0; i < PALMS / k; i++) {
      const side = i % 2 ? 1 : -1, z = zOf(i, (PALM_SPACING * k) / 2, (PALMS * PALM_SPACING) / 2, s + 3), g = grow(z);
      const x = side * (9 + ((i * 37) % 6)), h = (4.6 + ((i * 13) % 4) * 0.5) * g, lean = side * (0.05 + ((i * 7) % 3) * 0.025);
      set(trunks.current, i, x + (Math.sin(lean) * h) / 2, h / 2, z, g, h, g, 0, 0, -lean);
      const topX = x + Math.sin(lean) * h, topY = Math.cos(lean) * h;
      for (let f = 0; f < FRONDS; f++) {
        const angle = (f / FRONDS) * Math.PI * 2 + i;
        set(fronds.current, i * FRONDS + f, topX + Math.cos(angle) * 1.1 * g, topY - 0.25 * g, z - Math.sin(angle) * 1.1 * g, g, g, g, 0, angle, -0.45);
      }
      set(shadows.current, i, x + side * 0.5, 0.012, z, 2 * g, 1.4 * g, 1, -Math.PI / 2);
    }
    // Rounder roadside trees further out.
    for (let i = 0; i < TREES / k; i++) {
      const side = i % 2 ? -1 : 1, z = zOf(i, (TREE_SPACING * k) / 2, (TREES * TREE_SPACING) / 2, s + 7), g = grow(z);
      const x = side * (15 + ((i * 29) % 9)), r = (1.6 + ((i * 11) % 5) * 0.25) * g;
      set(treeTrunks.current, i, x, 1.1 * g, z, g, 2.2 * g, g);
      set(canopies.current, i, x, (2.2 * g) + r * 0.8, z, r, r * 0.85, r);
      set(shadows.current, PALMS + i, x + 0.4, 0.012, z, r * 1.6, r * 1.2, 1, -Math.PI / 2);
    }
    // Streetlights alternate sides; at night each throws a warm pool on the tarmac.
    for (let i = 0; i < Math.ceil(LIGHTS / k); i++) {
      const side = i % 2 ? 1 : -1, z = zOf(i, (LIGHT_SPACING * k) / 2, (LIGHTS * LIGHT_SPACING) / 2, s + 4), g = grow(z);
      set(poles.current, i, side * 5.6, 2.6 * g, z, g, g, g);
      set(lamps.current, i, side * 4.6, 5.1 * g, z, g, g, g);
      // The pool and the light cone stay attached to their lamp and leave the frame with it (never culled early).
      set(pools.current, i, side * 3.9, 0.015, z, 3.8 * g, 3.0 * g, 1, -Math.PI / 2);  // the beam's footprint: it lands on its own pool
      set(cones.current, i, side * 3.9, 2.55 * g, z, g, g, g);  // under the head's inner end (the head spans 3.6 to 5.6)
    }
    // Paddy-field rows on both sides: thin furrows that strobe past and sell the speed.
    for (let i = 0; i < ROWS / k; i++) {
      const side = i % 2 ? 1 : -1;
      set(rows.current, i, side * 13, 0.006, zOf(i, (ROW_SPACING * k) / 2, (ROWS * ROW_SPACING) / 2, s), 1, 1, 1 + throttle * 2);
    }
    all.forEach(ref => { if (ref.current) ref.current.instanceMatrix.needsUpdate = true; });

    if (signs) {
      // Signs swap destinations when they wrap from behind the camera back to the horizon, out of sight.
      const c = signCycle.current, grow = (z: number) => Math.min(1, Math.max(0.001, (z + FAR - 2) / 24));
      const swap = (face: THREE.Mesh | null, glow: THREE.Mesh | null, set: { board: THREE.Texture; glow: THREE.Texture }) => {
        // Same material, only the map changes: no shader recompile (the textures were uploaded up front).
        if (face) (face.material as THREE.MeshBasicMaterial).map = set.board;
        if (glow) (glow.material as THREE.MeshBasicMaterial).map = set.glow;
      };
      const gz = zOf(0, 0, GANTRY_PERIOD, s + 60);
      if (gz < c.gantryZ - 1) { c.gantryN = (c.gantryN + 1) % signs.gantries.length; swap(gantryFace.current, gantryGlow.current, signs.gantries[c.gantryN]); }
      c.gantryZ = gz;
      if (gantry.current) { gantry.current.position.z = gz; gantry.current.scale.setScalar(grow(gz)); }
      const bz = zOf(0, 0, BOARD_PERIOD, s + 136);
      if (bz < c.boardZ - 1) { c.boardN = (c.boardN + 1) % signs.boards.length; swap(boardFace.current, boardGlow.current, signs.boards[c.boardN]); }
      c.boardZ = bz;
      if (board.current) { board.current.position.z = bz; board.current.scale.setScalar(grow(bz)); }
    }

    // Far layer: the ridge and the gopuram drift slowly sideways (a long bend in the road), wrapping seamlessly.
    const drift = (s * 0.05) % RIDGE_W;
    if (ridgeA.current) ridgeA.current.position.x = -drift;
    if (ridgeB.current) ridgeB.current.position.x = RIDGE_W - drift;
    if (templeMesh.current) templeMesh.current.position.x = 70 - ((s * 0.03) % 140);

    // The camera dips and widens slightly with speed: the feeling of acceleration.
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov += (58 + throttle * 14 - perspective.fov) * (1 - Math.exp(-dt * 4));
    perspective.position.y = 1.25 - throttle * 0.18 + Math.sin(performance.now() / 260) * 0.012 * throttle;
    perspective.updateProjectionMatrix();
  });

  return (
    <>
      <color attach="background" args={[colors.skyLow]} />
      {/* By day only a thin warm haze far out, so near and mid scenery stay crisp; a warm, slightly golden sun. */}
      <fog attach="fog" args={[colors.haze, light ? 45 : 22, light ? 175 : 125]} />
      <ambientLight intensity={light ? 0.75 : 1} color={light ? "#FFF6E6" : "#FFFFFF"} />
      <directionalLight position={[-14, 12, 8]} intensity={light ? 1.5 : 0} color="#FFE3A8" />
      {!colors.moon && <mesh position={[-60, 6, -137]}><planeGeometry args={[90, 34]} />
        <meshBasicMaterial color="#FFE9B8" alphaMap={blob} transparent opacity={0.55} blending={THREE.AdditiveBlending} fog={false} depthWrite={false} /></mesh>}
      {/* Sky, moon and horizon skip fog: their colours are already distant. */}
      <mesh position={[0, 40, -140]}><planeGeometry args={[700, 90]} /><meshBasicMaterial map={sky} fog={false} depthWrite={false} /></mesh>
      {colors.moon && <mesh position={[38, 26, -138]}><circleGeometry args={[2.6, 32]} /><meshBasicMaterial color="#EFE7D2" fog={false} /></mesh>}
      <group position={[0, -0.5, -132]}>
        <group ref={ridgeA}><mesh geometry={ridgeFar} position={[0, 2, -2]}><meshBasicMaterial color={colors.hill2} fog={false} /></mesh></group>
        <group ref={ridgeB}><mesh geometry={ridgeFar} position={[0, 2, -2]}><meshBasicMaterial color={colors.hill2} fog={false} /></mesh></group>
        <mesh ref={templeMesh} geometry={temple} position={[34, 0, -1]}><meshBasicMaterial color={colors.gopuram} fog={false} /></mesh>
        <mesh geometry={ridgeNear} position={[-70, -3, 0]} scale={[1.2, 0.8, 1]}><meshBasicMaterial color={colors.hill} fog={false} /></mesh>
        <mesh geometry={ridgeNear} position={[190, -3, 0]} scale={[1.2, 0.8, 1]}><meshBasicMaterial color={colors.hill} fog={false} /></mesh>
      </group>

      {/* ground: fields either side, the road on top */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, -75]}><planeGeometry args={[400, 170]} /><meshBasicMaterial color={colors.field} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, -75]}><planeGeometry args={[11.2, 170]} /><meshBasicMaterial color={colors.shoulder} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -75]}><planeGeometry args={[8.4, 170]} /><meshBasicMaterial color={colors.road} /></mesh>
      {[-3.9, 3.9].map(x => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.01, -75]}><planeGeometry args={[0.12, 170]} /><meshBasicMaterial color={colors.edge} /></mesh>
      ))}

      <instancedMesh ref={rows} args={[undefined, undefined, ROWS]}><boxGeometry args={[14, 0.02, 0.35]} /><meshBasicMaterial color={colors.paddy} /></instancedMesh>
      <instancedMesh ref={dashes} args={[undefined, undefined, DASHES]}><boxGeometry args={[0.16, 0.01, 1.8]} /><meshBasicMaterial color={colors.lane} /></instancedMesh>
      {/* Steel W-beam guard rails on both sides: two continuous beams (no recycling, so they never pop), on short
          posts that do recycle, with reflector studs that catch the light at night. */}
      {[-1, 1].map(side => (
        <group key={side}>
          <mesh position={[side * RAIL_X, 0.58, NEAR - FAR / 2]}>
            <boxGeometry args={[0.06, 0.3, FAR + 8]} />
            {light ? <meshLambertMaterial color="#D6DBE1" /> : <meshBasicMaterial color="#474D55" />}
          </mesh>
          {/* the W-beam's centre fold, as a thin darker line on the road-facing side */}
          <mesh position={[side * (RAIL_X - 0.035), 0.58, NEAR - FAR / 2]}>
            <boxGeometry args={[0.01, 0.035, FAR + 8]} />
            <meshBasicMaterial color={light ? "#9AA2AB" : "#2C3036"} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={railPosts} args={[undefined, undefined, RAIL_POSTS]}><boxGeometry args={[0.09, 0.66, 0.09]} /><Lit color={light ? "#9DA4AC" : "#30353B"} light={light} /></instancedMesh>
      <instancedMesh ref={studs} args={[undefined, undefined, RAIL_POSTS]}><boxGeometry args={[0.02, 0.07, 0.07]} /><meshBasicMaterial color={colors.eye} toneMapped={false} /></instancedMesh>
      <instancedMesh ref={shadows} args={[undefined, undefined, PALMS + TREES]} visible={colors.shadow > 0}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#2A3A1E" alphaMap={blob} transparent opacity={colors.shadow} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, PALMS]}><cylinderGeometry args={[0.1, 0.16, 1, 5]} /><Lit color={colors.trunk} light={light} /></instancedMesh>
      <instancedMesh ref={fronds} args={[undefined, undefined, PALMS * FRONDS]}><boxGeometry args={[2.3, 0.04, 0.42]} /><Lit color="#FFFFFF" light={light} /></instancedMesh>
      <instancedMesh ref={treeTrunks} args={[undefined, undefined, TREES]}><cylinderGeometry args={[0.14, 0.2, 1, 5]} /><Lit color={colors.trunk} light={light} /></instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, TREES]}><icosahedronGeometry args={[1, 1]} /><Lit color={colors.tree} light={light} /></instancedMesh>
      <instancedMesh ref={poles} args={[undefined, undefined, LIGHTS]}><boxGeometry args={[0.1, 5.2, 0.1]} /><Lit color={colors.post} light={light} /></instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, LIGHTS]}><boxGeometry args={[2, 0.12, 0.22]} /><meshBasicMaterial color={colors.lamp} toneMapped={false} /></instancedMesh>
      {/* Faint additive light beams under each lamp at night: a rectangular spill that starts at the lamp's
          rectangular head and widens to its pool, so the beam has the lamp's own shape (not a round cone). */}
      <instancedMesh ref={cones} args={[undefined, undefined, LIGHTS]} visible={colors.poolOpacity > 0}>
        <primitive object={beamGeometry} attach="geometry" />
        <meshBasicMaterial color={colors.pool} transparent opacity={0.045} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.FrontSide} />
      </instancedMesh>
      <instancedMesh ref={pools} args={[undefined, undefined, LIGHTS]} visible={colors.poolOpacity > 0}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={colors.pool} alphaMap={blob} transparent opacity={colors.poolOpacity} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
      {signs && (
        <>
          {/* Overhead gantry: two grey steel posts, a truss beam and the board, high enough to drive under. */}
          <group ref={gantry}>
            {[-1, 1].map(side => (
              <mesh key={side} position={[side * 5.7, 3.1, 0]}><boxGeometry args={[0.28, 6.2, 0.28]} /><Lit color={light ? "#AEB4BA" : "#3C4148"} light={light} /></mesh>
            ))}
            <mesh position={[0, 6.05, -0.12]}><boxGeometry args={[11.8, 0.22, 0.22]} /><Lit color={light ? "#AEB4BA" : "#3C4148"} light={light} /></mesh>
            <mesh position={[0, 4.3, -0.12]}><boxGeometry args={[11.8, 0.16, 0.16]} /><Lit color={light ? "#AEB4BA" : "#3C4148"} light={light} /></mesh>
            <mesh ref={gantryFace} position={[0, 5.15, 0]}>
              <planeGeometry args={[9.2, 9.2 * 560 / 1536]} />
              {light ? <meshLambertMaterial map={signs.gantries[0].board} /> : <meshBasicMaterial map={signs.gantries[0].board} color="#5E6B64" />}
            </mesh>
            {/* At night the white letters and border are retroreflective: they catch the light and glow softly. */}
            <mesh ref={gantryGlow} position={[0, 5.15, 0.01]} visible={!light}>
              <planeGeometry args={[9.2, 9.2 * 560 / 1536]} />
              <meshBasicMaterial map={signs.gantries[0].glow} transparent opacity={0.85} color="#FFF4DA" toneMapped={false} depthWrite={false} />
            </mesh>
          </group>
          {/* A smaller direction board on a single post, on the left verge beyond the rail. */}
          <group ref={board}>
            <mesh position={[-6.6, 1.3, 0]}><boxGeometry args={[0.14, 2.6, 0.14]} /><Lit color={light ? "#AEB4BA" : "#3C4148"} light={light} /></mesh>
            <group position={[-6.6, 2.9, 0.08]} rotation-y={0.35}>
              <mesh ref={boardFace}>
                <planeGeometry args={[2.4, 1.5]} />
                {light ? <meshLambertMaterial map={signs.boards[0].board} /> : <meshBasicMaterial map={signs.boards[0].board} color="#5E6B64" />}
              </mesh>
              <mesh ref={boardGlow} position={[0, 0, 0.01]} visible={!light}>
                <planeGeometry args={[2.4, 1.5]} />
                <meshBasicMaterial map={signs.boards[0].glow} transparent opacity={0.85} color="#FFF4DA" toneMapped={false} depthWrite={false} />
              </mesh>
            </group>
          </group>
        </>
      )}
      <group ref={mileGroup}>
        {milestones.map((texture, i) => (
          <group key={i} position={[6.4, 0, -i * MILE_SPACING]} rotation-y={-0.5}>
            <mesh position={[0, 0.45, 0]}><boxGeometry args={[0.62, 0.9, 0.16]} /><Lit color="#E9E5DC" light={light} /></mesh>
            <mesh position={[0, 0.45, 0.081]}><planeGeometry args={[0.62, 0.86]} /><meshBasicMaterial map={texture} /></mesh>
          </group>
        ))}
      </group>
    </>
  );
}

export default function Road3D({ light, active, places }: { light: boolean; active: boolean; places: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  // Lite mode on 4-core-or-fewer devices from the start, or later if the measured frame budget is too slow.
  const [lite, setLite] = useState(() => (navigator.hardwareConcurrency ?? 8) <= 4 || new URLSearchParams(location.search).has("lite"));
  useEffect(() => { host.current?.setAttribute("data-lite", lite ? "1" : "0"); }, [lite]);
  useEffect(() => { host.current?.setAttribute("data-ready", "1"); }, []);
  return (
    <div className="lab-road3d" ref={host}>
      <Canvas flat dpr={lite ? 1 : [1, 1.25]} frameloop={active ? "always" : "never"} gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 1.25, NEAR], fov: 58, near: 0.1, far: FAR }}>
        <Scene light={light} places={places} lite={lite} onSlow={() => setLite(true)} />
      </Canvas>
    </div>
  );
}
