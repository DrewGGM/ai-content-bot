import { Composition } from "remotion";
import { Video, type VideoProps } from "./Video";

const dims = (format: string) =>
  format === "square"
    ? { width: 1080, height: 1080 }
    : format === "feed"
      ? { width: 1080, height: 1350 }
      : { width: 1080, height: 1920 };

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Video"
      component={Video}
      durationInFrames={255}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={
        {
          format: "reel",
          colors: { primary: "#5B2DC4", accent: "#00D4AA" },
          durationInFrames: 255,
          seed: 1,
          scenes: [
            { kind: "hook", eyebrow: "Facturación", text: "Deja de pelear con la DIAN", accentWord: "DIAN" },
            { kind: "stat", value: "0", label: "costo por folio", note: "Factura lo que necesites, sin excedentes." },
            { kind: "list", title: "Todo incluido", items: ["Facturación ilimitada", "Sin entrar a MUISCA", "Soporte en español"] },
            { kind: "cta", text: "Escríbenos por WhatsApp", sub: "7 días gratis, sin tarjeta" },
          ],
        } as VideoProps
      }
      calculateMetadata={({ props }: { props: VideoProps }) => {
        const d = dims(props.format);
        return { ...d, durationInFrames: props.durationInFrames ?? 255, fps: 30 };
      }}
    />
  );
};
