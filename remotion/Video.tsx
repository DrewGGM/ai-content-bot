/**
 * Composición principal del video por código.
 *
 * La IA entrega una SECUENCIA DE ESCENAS (ver scenes.tsx) en vez de un titular fijo, así que
 * la estructura cambia por pieza: gancho → dato → lista → cierre, o testimonio → antes/después
 * → cierre, etc. Aquí solo se reparte la duración, se aplica la transición entre escenas y se
 * dibujan los elementos persistentes (logo, barra de progreso, fondo).
 */
import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Colors, enterAt, useUnit } from "./theme";
import { Scene, SceneRenderer } from "./scenes";

export type VideoProps = {
  format: "reel" | "square" | "feed";
  scenes: Scene[];
  colors: Colors;
  durationInFrames: number;
  /** Logo como data URI (svg/png/jpg/webp) — lo inyecta generateRemotion; "" = sin logo. */
  logoSrc?: string;
  /** Semilla para variar el fondo entre piezas (mismo tema → distinto movimiento). */
  seed?: number;
};

/** Cuánto "pesa" cada escena al repartir la duración total. */
const WEIGHT: Record<Scene["kind"], number> = {
  hook: 1, stat: 1.05, list: 1.5, quote: 1.2, compare: 1.4, cta: 0.85,
};

/** Reparte `total` frames entre las escenas según su peso, con un mínimo legible. */
function layout(scenes: Scene[], total: number, fps: number): Array<{ from: number; dur: number }> {
  const MIN = Math.round(fps * 1.4); // por debajo de ~1.4s no da tiempo a leer
  const weights = scenes.map((s) => WEIGHT[s.kind] ?? 1);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let durs = weights.map((w) => Math.max(MIN, Math.round((total * w) / sum)));
  // Si los mínimos se pasan del total, se recorta proporcionalmente.
  const over = durs.reduce((a, b) => a + b, 0) - total;
  if (over > 0) {
    const scale = total / durs.reduce((a, b) => a + b, 0);
    durs = durs.map((d) => Math.max(Math.round(fps * 0.8), Math.round(d * scale)));
  }
  // El resto se le da a la última escena para cuadrar exacto con el audio.
  const drift = total - durs.reduce((a, b) => a + b, 0);
  durs[durs.length - 1] += drift;

  let from = 0;
  return durs.map((dur) => {
    const seg = { from, dur };
    from += dur;
    return seg;
  });
}

/**
 * Transición de ENTRADA de cada escena. Se alterna por índice para que el video no repita
 * siempre el mismo movimiento; la escena saliente ya se apaga sola (useOut en scenes.tsx).
 */
const Transition: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => {
  const frame = useCurrentFrame();
  const p = enterAt(frame, 0, 14);
  const mode = index % 3;
  let style: React.CSSProperties;
  if (mode === 0) {
    // push vertical
    style = { transform: `translateY(${(1 - p) * 7}%)`, opacity: p };
  } else if (mode === 1) {
    // wipe: la escena se descubre de abajo hacia arriba
    style = { clipPath: `inset(${(1 - p) * 100}% 0 0 0)` };
  } else {
    // scale + desenfoque corto
    style = { transform: `scale(${0.94 + p * 0.06})`, filter: `blur(${(1 - p) * 14}px)`, opacity: p };
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

/** Logo fijo arriba (se oculta en la escena de CTA, que dibuja el suyo grande). */
const LogoBar: React.FC<{ src?: string; hideFrom: number }> = ({ src, hideFrom }) => {
  const frame = useCurrentFrame();
  const u = useUnit();
  if (!src) return null;
  const inOp = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const outOp = interpolate(frame, [hideFrom - 10, hideFrom], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 74 * u, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: inOp * outOp }}>
      <Img src={src} style={{ height: 62 * u, width: "auto" }} />
    </div>
  );
};

/** Barra de progreso: le dice al espectador cuánto falta → sube la retención. */
const Progress: React.FC<{ c: Colors }> = ({ c }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const u = useUnit();
  const p = Math.min(1, frame / Math.max(1, durationInFrames));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8 * u, background: "rgba(255,255,255,.09)" }}>
      <div style={{ width: `${p * 100}%`, height: "100%", background: `linear-gradient(90deg, ${c.primary}, ${c.accent})` }} />
    </div>
  );
};

export const Video: React.FC<VideoProps> = (props) => {
  const { durationInFrames, fps } = useVideoConfig();
  const scenes = props.scenes?.length ? props.scenes : ([{ kind: "hook", text: "…" }] as Scene[]);
  const segs = layout(scenes, durationInFrames, fps);
  // El logo de la barra superior desaparece cuando arranca la escena de cierre.
  const ctaIndex = scenes.findIndex((s) => s.kind === "cta");
  const hideLogoFrom = ctaIndex >= 0 ? segs[ctaIndex].from : durationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "#070810" }}>
      <Background c={props.colors} seed={props.seed ?? 1} />
      <LogoBar src={props.logoSrc} hideFrom={hideLogoFrom} />
      {scenes.map((scene, i) => (
        <Sequence key={i} from={segs[i].from} durationInFrames={segs[i].dur}>
          <Transition index={i}>
            <SceneRenderer scene={scene} c={props.colors} dur={segs[i].dur} logoSrc={props.logoSrc} />
          </Transition>
        </Sequence>
      ))}
      <Progress c={props.colors} />
    </AbsoluteFill>
  );
};
