/* eslint-disable @next/next/no-img-element -- fotos vêm direto do servidor de imagens do Mercado Livre */

/** Foto do anúncio; sem foto, um quadrado cinza no mesmo tamanho. */
export function FotoProduto({ src, alt, tamanho = 32 }: { src: string | null | undefined; alt: string; tamanho?: number }) {
  const estilo = { width: tamanho, height: tamanho };
  if (!src) return <span aria-hidden className="inline-block shrink-0 rounded bg-bg" style={estilo} />;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="shrink-0 rounded object-cover" style={estilo} />;
}
