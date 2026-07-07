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
          headline: "Deja de pelear con la DIAN",
          accentWord: "DIAN",
          chips: ["Facturación ilimitada", "Sin costo por folio", "Sin entrar a MUISCA"],
          cta: "Escríbenos por WhatsApp",
          colors: { primary: "#5B2DC4", accent: "#00D4AA" },
          durationInFrames: 255,
        } as VideoProps
      }
      calculateMetadata={({ props }: { props: VideoProps }) => {
        const d = dims(props.format);
        return { ...d, durationInFrames: props.durationInFrames ?? 255, fps: 30 };
      }}
    />
  );
};
