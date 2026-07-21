/**
 * Librería de ESCENAS del video por código. La IA elige y ordena estas escenas por pieza
 * (ver generateRemotionCopy), así dos videos del mismo formato ya no se ven iguales.
 *
 * Cada escena recibe `dur` (su duración local en frames) y se dibuja con las primitivas de
 * theme.tsx. Todas comparten el mismo lenguaje: entrada por máscara, jerarquía tipográfica
 * fuerte y salida sincronizada con la transición.
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Colors, Eyebrow, FONT, KineticWords, MaskReveal, enterAt, outExpo, useSafePad, useUnit } from "./theme";

// ---------- Tipos de escena (contrato con la IA) ----------
export type Scene =
  | { kind: "hook"; text: string; accentWord?: string; eyebrow?: string }
  | { kind: "stat"; value: string; label: string; note?: string; eyebrow?: string }
  | { kind: "list"; title?: string; items: string[]; eyebrow?: string }
  | { kind: "quote"; text: string; author?: string }
  | { kind: "compare"; beforeLabel: string; before: string; afterLabel: string; after: string; eyebrow?: string }
  | { kind: "cta"; text: string; sub?: string };

export interface SceneProps { scene: Scene; c: Colors; dur: number; logoSrc?: string }

/** Salida común: las escenas se apagan justo antes de la transición. */
const useOut = (dur: number): number => {
  const frame = useCurrentFrame();
  return interpolate(frame, [dur - 10, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

const Pad: React.FC<{ children: React.ReactNode; out: number; justify?: string }> = ({ children, out, justify = "center" }) => {
  const safe = useSafePad();
  return (
    <AbsoluteFill style={{ justifyContent: justify, alignItems: "flex-start", ...safe, opacity: out }}>
      {children}
    </AbsoluteFill>
  );
};

// ---------- hook: el gancho de los primeros segundos ----------
const Hook: React.FC<SceneProps> = ({ scene, c, dur }) => {
  const u = useUnit();
  const out = useOut(dur);
  const s = scene as Extract<Scene, { kind: "hook" }>;
  // El titular manda: tamaño según cuánto texto haya, para que nunca se desborde.
  const words = s.text.trim().split(/\s+/).length;
  const size = (words <= 4 ? 168 : words <= 7 ? 136 : words <= 10 ? 112 : 94) * u;
  return (
    <Pad out={out}>
      {s.eyebrow ? <div style={{ marginBottom: 34 * u }}><Eyebrow text={s.eyebrow} c={c} size={26 * u} /></div> : null}
      <KineticWords text={s.text} accentWord={s.accentWord} accentColor={c.accent} size={size} delay={4} align="flex-start" />
    </Pad>
  );
};

// ---------- stat: un número que cuenta hacia arriba ----------
/** Anima solo la parte numérica y conserva prefijos/sufijos ("+1.5M", "0 folios", "10-15 min"). */
const CountUp: React.FC<{ value: string; delay: number }> = ({ value, delay }) => {
  const frame = useCurrentFrame();
  const p = outExpo(interpolate(frame - delay, [0, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  // Se anima el PRIMER número que aparezca; el resto del string se mantiene literal.
  const m = value.match(/\d[\d.,]*/);
  if (!m) return <>{value}</>;
  const raw = m[0];
  const decimals = (raw.split(/[.,]/)[1] ?? "").length;
  const target = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(target)) return <>{value}</>;
  const shown = (target * p).toFixed(decimals);
  return <>{value.slice(0, m.index) + shown + value.slice((m.index ?? 0) + raw.length)}</>;
};

const Stat: React.FC<SceneProps> = ({ scene, c, dur }) => {
  const u = useUnit();
  const out = useOut(dur);
  const frame = useCurrentFrame();
  const s = scene as Extract<Scene, { kind: "stat" }>;
  const glow = enterAt(frame, 6, 26);
  // El número es el protagonista absoluto de esta escena: tiene que llenar el ancho.
  const size = (s.value.length <= 3 ? 430 : s.value.length <= 5 ? 330 : s.value.length <= 8 ? 240 : 170) * u;
  return (
    <Pad out={out}>
      {s.eyebrow ? <div style={{ marginBottom: 30 * u }}><Eyebrow text={s.eyebrow} c={c} size={26 * u} /></div> : null}
      <MaskReveal delay={4} dur={22} style={{ paddingBottom: size * 0.06 }}>
        <span
          style={{
            display: "block", fontFamily: FONT, fontSize: size, fontWeight: 800,
            letterSpacing: -size * 0.045, lineHeight: 1,
            background: `linear-gradient(135deg, #fff 20%, ${c.accent} 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            textShadow: `0 0 ${90 * u * glow}px ${c.accent}55`,
          }}
        >
          <CountUp value={s.value} delay={8} />
        </span>
      </MaskReveal>
      <MaskReveal delay={20} style={{ marginTop: 14 * u }}>
        <span style={{ display: "block", fontFamily: FONT, fontSize: 56 * u, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>
          {s.label}
        </span>
      </MaskReveal>
      {s.note ? (
        <MaskReveal delay={30} style={{ marginTop: 16 * u }}>
          <span style={{ display: "block", fontFamily: FONT, fontSize: 38 * u, fontWeight: 500, color: "#ffffffa8", lineHeight: 1.4 }}>
            {s.note}
          </span>
        </MaskReveal>
      ) : null}
    </Pad>
  );
};

// ---------- list: bullets que entran escalonados ----------
const List: React.FC<SceneProps> = ({ scene, c, dur }) => {
  const u = useUnit();
  const out = useOut(dur);
  const frame = useCurrentFrame();
  const s = scene as Extract<Scene, { kind: "list" }>;
  const items = s.items.slice(0, 4);
  const size = items.length >= 4 ? 56 * u : 66 * u;
  return (
    <Pad out={out}>
      {s.eyebrow ? <div style={{ marginBottom: 26 * u }}><Eyebrow text={s.eyebrow} c={c} size={26 * u} /></div> : null}
      {s.title ? (
        <MaskReveal delay={4} dur={20} style={{ marginBottom: 44 * u, paddingBottom: 8 * u }}>
          <span style={{ display: "block", fontFamily: FONT, fontSize: 82 * u, fontWeight: 800, letterSpacing: -2 * u, color: "#fff", lineHeight: 1.06 }}>
            {s.title}
          </span>
        </MaskReveal>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 22 * u, width: "100%" }}>
        {items.map((text, i) => {
          const d = 14 + i * 9;
          const p = enterAt(frame, d, 20);
          return (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: size * 0.55,
                // Entra deslizando desde la izquierda + la línea se "dibuja" con clip-path.
                transform: `translateX(${(1 - p) * -60 * u}px)`,
                opacity: p,
                clipPath: `inset(0 ${(1 - p) * 100}% 0 0 round ${size * 0.42}px)`,
                background: "rgba(255,255,255,.06)",
                border: "1px solid rgba(255,255,255,.12)",
                borderLeft: `${6 * u}px solid ${c.accent}`,
                borderRadius: size * 0.42,
                padding: `${size * 0.5}px ${size * 0.62}px`,
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: size * 0.72, fontWeight: 800, color: c.accent, minWidth: size * 0.9 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontFamily: FONT, fontSize: size, fontWeight: 650, color: "#fff", lineHeight: 1.22 }}>{text}</span>
            </div>
          );
        })}
      </div>
    </Pad>
  );
};

// ---------- quote: testimonio / manifiesto ----------
const Quote: React.FC<SceneProps> = ({ scene, c, dur }) => {
  const u = useUnit();
  const out = useOut(dur);
  const s = scene as Extract<Scene, { kind: "quote" }>;
  const size = s.text.length > 90 ? 62 * u : 82 * u;
  return (
    <Pad out={out}>
      <MaskReveal delay={2} dur={18}>
        <span style={{ display: "block", fontFamily: FONT, fontSize: 190 * u, fontWeight: 800, color: c.accent, lineHeight: 0.7, opacity: 0.85 }}>
          &ldquo;
        </span>
      </MaskReveal>
      <div style={{ marginTop: 30 * u }}>
        <KineticWords text={s.text} accentColor={c.accent} size={size} delay={10} align="flex-start" />
      </div>
      {s.author ? (
        <MaskReveal delay={34} style={{ marginTop: 34 * u }}>
          <span style={{ display: "block", fontFamily: FONT, fontSize: 38 * u, fontWeight: 600, color: "#ffffffa8", letterSpacing: 1.5 * u }}>
            — {s.author}
          </span>
        </MaskReveal>
      ) : null}
    </Pad>
  );
};

// ---------- compare: antes vs. después ----------
const Compare: React.FC<SceneProps> = ({ scene, c, dur }) => {
  const u = useUnit();
  const out = useOut(dur);
  const frame = useCurrentFrame();
  const s = scene as Extract<Scene, { kind: "compare" }>;
  const cols: Array<{ label: string; text: string; good: boolean }> = [
    { label: s.beforeLabel, text: s.before, good: false },
    { label: s.afterLabel, text: s.after, good: true },
  ];
  return (
    <Pad out={out}>
      {s.eyebrow ? <div style={{ marginBottom: 34 * u }}><Eyebrow text={s.eyebrow} c={c} size={26 * u} /></div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 26 * u, width: "100%" }}>
        {cols.map((col, i) => {
          const p = enterAt(frame, 8 + i * 14, 22);
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 40 * u}px)`,
                background: col.good ? `linear-gradient(135deg, ${c.accent}26, ${c.primary}1a)` : "rgba(255,255,255,.05)",
                border: `1px solid ${col.good ? c.accent + "66" : "rgba(255,255,255,.11)"}`,
                borderRadius: 34 * u,
                padding: `${34 * u}px ${38 * u}px`,
              }}
            >
              <span
                style={{
                  fontFamily: FONT, fontSize: 26 * u, fontWeight: 800, letterSpacing: 3 * u,
                  textTransform: "uppercase", color: col.good ? c.accent : "#ffffff7a",
                }}
              >
                {col.label}
              </span>
              <div style={{ height: 14 * u }} />
              <span
                style={{
                  fontFamily: FONT, fontSize: 58 * u, fontWeight: 750, lineHeight: 1.18,
                  color: col.good ? "#fff" : "#ffffff9e",
                  textDecoration: col.good ? "none" : "line-through",
                  textDecorationColor: "#ff6b6b99",
                }}
              >
                {col.text}
              </span>
            </div>
          );
        })}
      </div>
    </Pad>
  );
};

// ---------- cta: cierre con logo ----------
const Cta: React.FC<SceneProps> = ({ scene, c, dur, logoSrc }) => {
  const u = useUnit();
  const out = useOut(dur);
  const frame = useCurrentFrame();
  const s = scene as Extract<Scene, { kind: "cta" }>;
  const p = enterAt(frame, 4, 22);
  // Respiración muy leve: da vida sin distraer del texto.
  const breath = 1 + Math.sin(frame / 14) * 0.012;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 9%", gap: 40 * u, opacity: out }}>
      {logoSrc ? (
        <Img src={logoSrc} style={{ height: 96 * u, width: "auto", opacity: p, transform: `translateY(${(1 - p) * 26 * u}px)` }} />
      ) : null}
      {s.sub ? (
        <MaskReveal delay={12}>
          <span style={{ display: "block", fontFamily: FONT, fontSize: 44 * u, fontWeight: 600, color: "#ffffffbb", textAlign: "center", lineHeight: 1.35 }}>
            {s.sub}
          </span>
        </MaskReveal>
      ) : null}
      <div
        style={{
          transform: `scale(${(0.86 + p * 0.14) * breath})`,
          opacity: p,
          background: `linear-gradient(135deg, ${c.accent}, ${c.primary})`,
          color: "#06170f",
          fontFamily: FONT, fontSize: 56 * u, fontWeight: 800, letterSpacing: -0.5 * u,
          padding: `${32 * u}px ${62 * u}px`,
          borderRadius: 999,
          boxShadow: `0 ${24 * u}px ${80 * u}px ${c.accent}55`,
          textAlign: "center",
        }}
      >
        {s.text}
      </div>
    </AbsoluteFill>
  );
};

const REGISTRY: Record<Scene["kind"], React.FC<SceneProps>> = {
  hook: Hook, stat: Stat, list: List, quote: Quote, compare: Compare, cta: Cta,
};

export const SceneRenderer: React.FC<SceneProps> = (props) => {
  const Comp = REGISTRY[props.scene.kind] ?? Hook;
  return <Comp {...props} />;
};
