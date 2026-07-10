import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export type VideoProps = {
  format: "reel" | "square" | "feed";
  headline: string;
  accentWord?: string;
  chips: string[];
  cta: string;
  colors: { primary: string; accent: string };
  durationInFrames: number;
  /** Logo como data URI (svg/png/jpg/webp) — lo inyecta generateRemotion; "" = sin logo. */
  logoSrc?: string;
};

// Fondo: gradiente de marca animado (violeta + acento).
const Bg: React.FC<{ c: VideoProps["colors"] }> = ({ c }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / Math.max(1, durationInFrames);
  const x = 50 + Math.sin(t * Math.PI * 2) * 22;
  const y = 42 + Math.cos(t * Math.PI * 2) * 18;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(58% 45% at ${x}% ${y}%, ${c.accent}44 0%, transparent 60%),
          radial-gradient(70% 58% at ${100 - x}% ${100 - y}%, ${c.primary}dd 0%, transparent 66%),
          linear-gradient(160deg, #12103a 0%, #0a0b16 100%)`,
      }}
    />
  );
};

// Logo por data URI (lo pasa generateRemotion desde assets/brand). Sin logo → no se dibuja
// nada (antes un staticFile("logo.svg") inexistente o con formato equivocado tumbaba el render).
const Logo: React.FC<{ h: number; src?: string }> = ({ h, src }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  if (!src) return null;
  return (
    <div style={{ position: "absolute", top: h * 0.05, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: o }}>
      <Img src={src} style={{ height: h > 1500 ? 84 : 66, width: "auto" }} />
    </div>
  );
};

// Titular cinético: palabras con spring escalonado; acentúa accentWord.
const Headline: React.FC<{ text: string; accent?: string; color: string; size: number; localDur: number }> = ({ text, accent, color, size, localDur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [localDur - 12, localDur], [1, 0], { extrapolateLeft: "clamp" });
  const words = text.toUpperCase().split(/\s+/);
  const acc = (accent ?? "").toUpperCase();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 8%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.18}px`, opacity: out }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 5, fps, config: { damping: 14, stiffness: 120 } });
          const isAcc = acc && w.replace(/[^\wÁÉÍÓÚÑ]/gi, "") === acc.replace(/[^\wÁÉÍÓÚÑ]/gi, "");
          return (
            <span key={i} style={{ fontFamily: FONT, fontSize: size, fontWeight: 800, lineHeight: 1.04, color: isAcc ? color : "#fff", transform: `translateY(${(1 - s) * 55}px) scale(${0.7 + s * 0.3})`, opacity: s, textShadow: "0 8px 40px rgba(0,0,0,.4)" }}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Chips: React.FC<{ chips: string[]; c: VideoProps["colors"]; size: number; localDur: number }> = ({ chips, c, size, localDur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [localDur - 12, localDur], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "stretch", padding: "0 8%", gap: size * 0.4, opacity: out }}>
      {chips.slice(0, 3).map((text, i) => {
        const s = spring({ frame: frame - i * 9, fps, config: { damping: 16, stiffness: 100 } });
        return (
          <div key={i} style={{ transform: `translateX(${(1 - s) * -50}px)`, opacity: s, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.13)", borderRadius: size * 0.4, padding: `${size * 0.5}px ${size * 0.6}px`, display: "flex", alignItems: "center", gap: size * 0.35 }}>
            <div style={{ width: size * 0.75, height: size * 0.75, borderRadius: size * 0.2, background: `linear-gradient(135deg, ${c.primary}, ${c.accent})`, flex: "none" }} />
            <span style={{ fontFamily: FONT, fontSize: size, fontWeight: 700, color: "#fff" }}>{text}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ cta: string; c: VideoProps["colors"]; size: number }> = ({ cta, c, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15 } });
  const pulse = 1 + Math.sin(frame / 6) * 0.02;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: size * 0.6 }}>
      <div style={{ transform: `scale(${s * pulse})`, opacity: s, background: `linear-gradient(135deg, ${c.accent}, #00a578)`, color: "#04150f", fontFamily: FONT, fontSize: size, fontWeight: 800, padding: `${size * 0.55}px ${size}px`, borderRadius: 999, boxShadow: `0 20px 60px ${c.accent}55`, textAlign: "center" }}>
        {cta}
      </div>
    </AbsoluteFill>
  );
};

export const Video: React.FC<VideoProps> = (props) => {
  const { width, height, durationInFrames } = useVideoConfig();
  const vertical = height > width;
  // Tamaños responsivos según altura del lienzo.
  const hSize = height > 1500 ? 128 : height > 1200 ? 104 : 90; // titular
  const cSize = height > 1500 ? 52 : 46; // chips
  const ctaSize = height > 1500 ? 56 : 48;

  // Escenas proporcionales a la duración: titular 42% · chips 40% · CTA 18%.
  const a = Math.round(durationInFrames * 0.42);
  const b = Math.round(durationInFrames * 0.4);
  const cc = durationInFrames - a - b;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0b16" }}>
      <Bg c={props.colors} />
      <Logo h={height} src={props.logoSrc} />
      <Sequence from={0} durationInFrames={a}>
        <Headline text={props.headline} accent={props.accentWord} color={props.colors.accent} size={vertical ? hSize : hSize * 0.85} localDur={a} />
      </Sequence>
      <Sequence from={a} durationInFrames={b}>
        <Chips chips={props.chips} c={props.colors} size={cSize} localDur={b} />
      </Sequence>
      <Sequence from={a + b} durationInFrames={cc}>
        <Cta cta={props.cta} c={props.colors} size={ctaSize} />
      </Sequence>
    </AbsoluteFill>
  );
};
