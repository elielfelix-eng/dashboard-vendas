/**
 * Lista a configuração do Bitrix24 (funis, etapas, origens, campos personalizados
 * e totais) para o dono escolher o que entra no painel.
 * Só leitura. Não mostra dados de clientes, e-mails nem a URL do webhook.
 * Uso: npm run bitrix:config -w jobs   (precisa de BITRIX_WEBHOOK_URL no ambiente)
 */
import { BitrixClient } from '@dash/connectors';

type Status = { ENTITY_ID: string; STATUS_ID: string; NAME: string; SORT: string; SEMANTICS?: string | null; CATEGORY_ID?: string };
type Campo = { type: string; title?: string; listLabel?: string; formLabel?: string; isMultiple?: boolean; items?: { ID: string; VALUE: string }[] };

const SEM: Record<string, string> = { S: 'ganho', F: 'perdido', P: 'em andamento' };

async function main() {
  const bx = new BitrixClient(process.env.BITRIX_WEBHOOK_URL ?? '');

  const total = async (method: string, filter: Record<string, unknown> = {}) =>
    (await bx.call<unknown[]>(method, { select: ['ID'], filter })).total ?? 0;

  console.log('=== TOTAIS ===');
  console.log(`Leads: ${await total('crm.lead.list')}`);
  console.log(`Negócios: ${await total('crm.deal.list')}`);
  console.log(`Contatos: ${await total('crm.contact.list')}`);
  console.log(`Empresas: ${await total('crm.company.list')}`);
  const primeiro = await bx.call<{ DATE_CREATE: string }[]>('crm.lead.list', { select: ['ID', 'DATE_CREATE'], order: { DATE_CREATE: 'ASC' } });
  console.log(`Lead mais antigo: ${primeiro.result[0]?.DATE_CREATE ?? '-'}`);

  const usuarios = await bx.listarTudo<{ ACTIVE: boolean }>('user.get', {});
  console.log(`Usuários do Bitrix: ${usuarios.length} (ativos: ${usuarios.filter((u) => u.ACTIVE).length})`);

  console.log('\n=== FUNIS DE NEGÓCIO ===');
  const cats = (await bx.call<{ categories: { id: number; name: string; isDefault?: string }[] }>('crm.category.list', { entityTypeId: 2 })).result.categories;
  for (const c of cats) console.log(`[${c.id}] ${c.name}${c.isDefault === 'Y' ? ' (padrão)' : ''}`);

  const status = await bx.listarTudo<Status>('crm.status.list', { order: { ENTITY_ID: 'ASC', SORT: 'ASC' } });
  const grupo = (pred: (s: Status) => boolean) => status.filter(pred).sort((a, b) => Number(a.SORT) - Number(b.SORT));
  // Funis escolhidos pelo dono (padrão: Brinde do Bem = 10)
  const funis = (process.env.BITRIX_FUNIS || '10').split(',').map((x) => Number(x.trim()));
  for (const id of funis) {
    const ent = id === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${id}`;
    const nome = cats.find((c) => c.id === id)?.name ?? '?';
    console.log(`\n=== ETAPAS DO FUNIL [${id}] ${nome} (negócios por etapa) ===`);
    for (const s of grupo((s) => s.ENTITY_ID === ent)) {
      const n = await total('crm.deal.list', { CATEGORY_ID: id, STAGE_ID: s.STATUS_ID });
      console.log(`  ${s.STATUS_ID.padEnd(22)} ${s.NAME}${s.SEMANTICS ? ` (${SEM[s.SEMANTICS] ?? s.SEMANTICS})` : ''} — ${n}`);
    }
  }

  const desde = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  console.log(`\n=== ORIGENS: leads (total | últimos 12 meses) e negócios nos funis ${funis.join(',')} ===`);
  for (const s of grupo((s) => s.ENTITY_ID === 'SOURCE')) {
    const leads = await total('crm.lead.list', { SOURCE_ID: s.STATUS_ID });
    const leads12 = await total('crm.lead.list', { SOURCE_ID: s.STATUS_ID, '>=DATE_CREATE': desde });
    const negocios = await total('crm.deal.list', { SOURCE_ID: s.STATUS_ID, '@CATEGORY_ID': funis });
    console.log(`  ${s.STATUS_ID.padEnd(22)} ${s.NAME.padEnd(34)} leads: ${String(leads).padStart(6)} | ${String(leads12).padStart(6)}   negócios: ${negocios}`);
  }

  for (const [ent, nome] of [['crm.deal.fields', 'NEGÓCIO']] as const) {
    console.log(`\n=== CAMPOS PERSONALIZADOS DO ${nome} ===`);
    const campos = (await bx.call<Record<string, Campo>>(ent)).result;
    for (const [k, c] of Object.entries(campos)) {
      if (!k.startsWith('UF_CRM_')) continue;
      const rotulo = c.listLabel || c.formLabel || c.title || '';
      console.log(`  ${k.padEnd(28)} ${c.type.padEnd(12)} ${rotulo}`);
      if (c.items?.length) console.log(`      opções: ${c.items.map((i) => i.VALUE).join(' | ')}`);
    }
  }
}

main().catch((err) => {
  console.error('Falha ao listar a configuração do Bitrix:', (err as Error).message);
  process.exit(1);
});
