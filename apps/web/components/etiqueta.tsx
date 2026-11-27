// Etiqueta pequena para sugestões e situações (ex.: "Escalar", "Pausar", alertas).
// O texto vem de quem chama (ex.: rotuloSugestao em lib/crescimento.ts); aqui só há o tom visual.
export type TomEtiqueta = 'neutro' | 'bom' | 'ruim' | 'alerta' | 'marca';

const TONS: Record<TomEtiqueta, string> = {
  neutro: 'bg-bg text-muted',
  bom: 'bg-good/15 text-good',
  ruim: 'bg-bad/15 text-bad',
  alerta: 'bg-warn/15 text-warn',
  marca: 'bg-accent-soft text-text',
};

export function Etiqueta({ tom = 'neutro', children }: { tom?: TomEtiqueta; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TONS[tom]}`}>
      {children}
    </span>
  );
}
