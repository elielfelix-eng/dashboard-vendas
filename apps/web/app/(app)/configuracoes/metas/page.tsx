import { UploadMetas } from '@/components/upload-metas';
import { exigirPermissao } from '@/lib/permissoes';

export default async function UploadMetasPage() {
  await exigirPermissao('editar_metas');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Metas (upload)</h1>
      <p className="mb-4 text-sm text-muted">
        Planilha .xlsx com as colunas <strong>Canal</strong> (ou Marketplace), <strong>Ano</strong>, <strong>Mês</strong> e <strong>Meta</strong>,
        com o título na linha 1. Canais aceitos: Mercado Livre, Shopee e Brinde do Bem. Mês pode ser Jan…Dez ou 1…12.
        Ao gravar, as metas dos anos que estão no arquivo são substituídas; os outros anos não mudam.
      </p>
      <UploadMetas />
    </div>
  );
}
