/** Esqueleto mostrado na hora em que se troca de página, enquanto o servidor calcula os números. */
export default function Carregando() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="fixed inset-x-0 top-0 z-50 h-1 animate-pulse bg-accent" />
      <div className="mb-4 h-8 w-48 animate-pulse rounded bg-border" />
      <div className="mb-6 h-14 animate-pulse rounded-xl border border-border bg-surface" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">Carregando os números…</p>
    </div>
  );
}
