import Image from "next/image";

type LogoProps = {
  size?: number;
  variant?: "mark" | "wordmark";
};

export function Logo({
  size = 32,
  variant = "wordmark"
}: LogoProps) {
  const isWordmark = variant === "wordmark";
  const width = isWordmark ? Math.round(size * (220 / 64)) : size;

  return (
    <Image
      alt={isWordmark ? "Stoop" : "Stoop mark"}
      height={size}
      unoptimized
      src={
        isWordmark
          ? "/assets/brand/logo-wordmark.svg"
          : "/assets/brand/logo-mark.svg"
      }
      width={width}
    />
  );
}
