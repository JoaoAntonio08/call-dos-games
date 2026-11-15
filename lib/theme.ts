const DEFAULT = "#5865f2";

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Cores de destaque do app tingidas com a cor do servidor.
 * Cor clara demais vira um tom mais escuro no fundo dos botões, para o texto branco continuar legível.
 */
export function accentVars(accent: string | undefined): React.CSSProperties | undefined {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent) || accent.toLowerCase() === DEFAULT) return undefined;
  const light = luminance(accent) > 0.45;
  return {
    ["--color-ember" as string]: light ? `color-mix(in srgb, ${accent} 55%, #000)` : accent,
    ["--color-ember-2" as string]: light ? accent : `color-mix(in srgb, ${accent} 78%, #fff)`,
  };
}
