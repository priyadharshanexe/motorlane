// The hero's signature 3D moment: a procedural road (no downloaded models) seen from the driver's seat.
// Lane dashes stream towards the camera at the shared `drive` speed and stretch into streaks as it rises;
// kerb posts and kilometre markers flick past at the edges. DPR is capped, the frame loop stops when the
// hero is offscreen, and this file is lazy-loaded so it never delays the first paint.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { drive } from "./drive";

const DASHES = 26, SPACING = 6, POSTS = 18, POST_SPACING = 9;

function Scene({ light }: { light: boolean }) {
  const dashes = useRef<THREE.InstancedMesh>(null);
  const posts = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const temp = useMemo(() => new THREE.Object3D(), []);
  const offset = useRef(0);
  const colors = light
    ? { road: "#3A3D42", edge: "#F4F1EA", lane: "#FFC531", post: "#E9E4D8", sky: "#E8E4DA" }
    : { road: "#1C1F23", edge: "#D8D4CB", lane: "#FFC531", post: "#3A3F46", sky: "#121417" };

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    // Road units per second: a gentle crawl at idle, a rush at full throttle.
    const speed = 4 + drive.throttle * 70;
    offset.current = (offset.current + speed * dt) % (SPACING * POST_SPACING * 2);
    const stretch = 1 + drive.throttle * 3.2;  // dashes turn into streaks with speed
    for (let i = 0; i < DASHES; i++) {
      const z = -i * SPACING + (offset.current % SPACING);  // moves towards the camera, wraps every dash
      temp.position.set(0, 0.011, z);
      temp.scale.set(1, 1, stretch);
      temp.updateMatrix();
      dashes.current!.setMatrixAt(i, temp.matrix);
    }
    dashes.current!.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < POSTS; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -Math.floor(i / 2) * POST_SPACING * 2 - (side > 0 ? POST_SPACING : 0) + (offset.current % (POST_SPACING * 2));
      temp.position.set(side * 4.6, 0.45, z);
      temp.scale.set(1, 1, 1 + drive.throttle * 1.5);
      temp.updateMatrix();
      posts.current!.setMatrixAt(i, temp.matrix);
    }
    posts.current!.instanceMatrix.needsUpdate = true;
    // The camera dips and widens slightly with speed: the feeling of acceleration.
    const target = 58 + drive.throttle * 14;
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov += (target - perspective.fov) * (1 - Math.exp(-dt * 4));
    perspective.position.y = 1.25 - drive.throttle * 0.18 + Math.sin(performance.now() / 260) * 0.012 * drive.throttle;
    perspective.updateProjectionMatrix();
  });

  return (
    <>
      <color attach="background" args={[colors.sky]} />
      <fog attach="fog" args={[colors.sky, 18, 120]} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -70]}>
        <planeGeometry args={[8.4, 160]} />
        <meshBasicMaterial color={colors.road} />
      </mesh>
      {[-3.9, 3.9].map(x => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.01, -70]}>
          <planeGeometry args={[0.12, 160]} />
          <meshBasicMaterial color={colors.edge} />
        </mesh>
      ))}
      <instancedMesh ref={dashes} args={[undefined, undefined, DASHES]}>
        <boxGeometry args={[0.16, 0.01, 2.2]} />
        <meshBasicMaterial color={colors.lane} />
      </instancedMesh>
      <instancedMesh ref={posts} args={[undefined, undefined, POSTS]}>
        <boxGeometry args={[0.12, 0.9, 0.12]} />
        <meshBasicMaterial color={colors.post} />
      </instancedMesh>
    </>
  );
}

export default function Road3D({ light, active }: { light: boolean; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { host.current?.setAttribute("data-ready", "1"); }, []);
  return (
    <div className="lab-road3d" ref={host}>
      <Canvas dpr={[1, 1.25]} frameloop={active ? "always" : "never"} gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 1.25, 4], fov: 58, near: 0.1, far: 140 }}>
        <Scene light={light} />
      </Canvas>
    </div>
  );
}
