// Validacao dos grupos de anuncios (core.grupos_anuncio). Funcao pura, sem acesso a banco.
export type ResultadoGrupo =
  | { ok: true; nome: string; antecedencia: number }
  | { ok: false; erro: string };

export function validarGrupo(nome: string, antecedencia: string): ResultadoGrupo {
  const n = String(nome ?? '').trim();
  if (n.length < 1 || n.length > 60) return { ok: false, erro: 'O nome do grupo deve ter de 1 a 60 caracteres.' };
  const t = String(antecedencia ?? '').trim();
  const a = t === '' ? NaN : Number(t);
  if (!Number.isInteger(a) || a < 0 || a > 30) {
    return { ok: false, erro: 'A antecedência deve ser um número inteiro de 0 a 30 dias úteis.' };
  }
  return { ok: true, nome: n, antecedencia: a };
}

// Compara nomes de grupo sem diferenciar maiusculas de minusculas nem espacos das pontas.
export function mesmoNome(a: string, b: string): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}
