/**
 * Fondo, texturas y primitivas de animación compartidas por todas las escenas.
 *
 * La regla del look: NADA aparece con un fade plano. Todo entra por MÁSCARA (clip-path) con
 * un desplazamiento corto, que es lo que separa un motion-graphic de "texto con opacidad".
 * El fondo nunca está quieto (deriva + parallax) pero se mueve MUY lento: la atención va al
 * texto, no al fondo.
 */
import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";

export const FONT = '"Segoe UI", "Helvetica Neue", Inter, Arial, sans-serif';

/** Colores de marca que llegan por props. */
export interface Colors { primary: string; accent: string }

/** Unidad de escala: todo se dimensiona contra un lienzo de referencia de 1920px de alto. */
export const useUnit = (): number => {
  const { height } = useVideoConfig();
  return height / 1920;
};

/**
 * Zona segura: en vertical, Instagram y TikTok tapan la franja inferior con el caption, el
 * usuario y los botones, y la superior con la barra de estado. El texto se compone DENTRO de
 * esta banda o se pierde detrás de la UI de la app.
 */
export const useSafePad = (): React.CSSProperties => {
  const { width, height } = useVideoConfig();
  const vertical = height / width > 1.4;
  return {
    paddingTop: vertical ? "15%" : "10%",
    paddingBottom: vertical ? "24%" : "12%",
    paddingLeft: "9%",
    paddingRight: "9%",
  };
};

/** Easing suave para entradas/salidas (equivalente a cubic-bezier out-expo). */
export const outExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const inOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Progreso 0→1 de la entrada de un elemento, con retardo en frames. */
export const enterAt = (frame: number, delay: number, dur = 18): number =>
  outExpo(interpolate(frame - delay, [0, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

// ---------- Texturas ----------

/** Grano de película: quita el aspecto "CSS plano" de los degradados. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.055 }) => (
  <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
    <svg width="100%" height="100%">
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  </AbsoluteFill>
);

/** Viñeta: cierra los bordes y empuja la mirada al centro. */
export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: "radial-gradient(72% 58% at 50% 45%, transparent 40%, rgba(0,0,0,.55) 100%)",
      pointerEvents: "none",
    }}
  />
);

/**
 * Manchas de color desenfocadas que derivan en PARALLAX (cada una a distinta velocidad).
 * Es lo que da sensación de profundidad frente al degradado fijo de antes.
 */
export const Blobs: React.FC<{ c: Colors; seed?: number }> = ({ c, seed = 1 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames);
  const spec = [
    { col: c.accent, size: 0.95, depth: 1.0, op: 0.34 },
    { col: c.primary, size: 1.35, depth: 0.55, op: 0.5 },
    { col: c.accent, size: 0.7, depth: 1.5, op: 0.2 },
  ];
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {spec.map((s, i) => {
        const r = random(`blob-${seed}-${i}`);
        const phase = r * Math.PI * 2;
        // Órbitas lentas y de radio distinto por capa → parallax.
        const x = 50 + Math.sin(t * Math.PI * 2 * s.depth + phase) * (18 + r * 14);
        const y = 45 + Math.cos(t * Math.PI * 2 * s.depth * 0.8 + phase) * (16 + r * 12);
        const d = Math.max(width, height) * s.size;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`, top: `${y}%`,
              width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${s.col} 0%, transparent 62%)`,
              opacity: s.op,
              filter: `blur(${d * 0.09}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Fondo completo de marca: base oscura + manchas en parallax + grano + viñeta. */
export const Background: React.FC<{ c: Colors; seed?: number }> = ({ c, seed }) => (
  <AbsoluteFill style={{ background: `linear-gradient(165deg, #14113f 0%, #0a0b16 55%, #070810 100%)` }}>
    <Blobs c={c} seed={seed} />
    <Vignette />
    <Grain />
  </AbsoluteFill>
);

// ---------- Primitivas de texto ----------

/**
 * Revelado por MÁSCARA: el texto sube desde debajo de una ventana recortada. Es la diferencia
 * entre "aparece texto" y "el texto entra". Nunca usar opacidad sola para esto.
 */
export const MaskReveal: React.FC<{
  delay?: number;
  dur?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, dur = 18, children, style }) => {
  const frame = useCurrentFrame();
  const p = enterAt(frame, delay, dur);
  return (
    <div style={{ overflow: "hidden", ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 105}%)` }}>{children}</div>
    </div>
  );
};

/** Titular cinético: cada palabra entra por máscara con stagger. */
export const KineticWords: React.FC<{
  text: string;
  accentWord?: string;
  accentColor: string;
  size: number;
  delay?: number;
  align?: "center" | "flex-start";
}> = ({ text, accentWord, accentColor, size, delay = 0, align = "center" }) => {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const norm = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const acc = norm(accentWord ?? "");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align, gap: `${size * 0.06}px ${size * 0.24}px` }}>
      {words.map((w, i) => (
        <MaskReveal key={i} delay={delay + i * 3.5} dur={20} style={{ paddingBottom: size * 0.08 }}>
          <span
            style={{
              display: "block",
              fontFamily: FONT,
              fontSize: size,
              fontWeight: 800,
              letterSpacing: -size * 0.028,
              lineHeight: 1.02,
              color: acc && norm(w) === acc ? accentColor : "#fff",
              textShadow: "0 10px 44px rgba(0,0,0,.45)",
            }}
          >
            {w.toUpperCase()}
          </span>
        </MaskReveal>
      ))}
    </div>
  );
};

/** Etiqueta pequeña de sección (eyebrow) con línea de acento. */
export const Eyebrow: React.FC<{ text: string; c: Colors; size: number; delay?: number }> = ({ text, c, size, delay = 0 }) => {
  const frame = useCurrentFrame();
  const p = enterAt(frame, delay, 16);
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.7, opacity: p }}>
      <div style={{ width: size * 2.2 * p, height: size * 0.16, background: c.accent, borderRadius: 99 }} />
      <span
        style={{
          fontFamily: FONT, fontSize: size, fontWeight: 700,
          letterSpacing: size * 0.16, textTransform: "uppercase", color: c.accent,
        }}
      >
        {text}
      </span>
    </div>
  );
};
