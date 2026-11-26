import type { Canal } from '@/lib/periodo';

type Onde = 'ml' | 'shopee' | 'todos';

/** "Como os números são calculados" (texto da V1 atualizado para as regras atuais), com as regras do canal escolhido. */
export function ComoCalculamos({ verCustos, canal = 'mercadolivre' }: { verCustos: boolean; canal?: Canal }) {
  const ambos = canal === 'consolidado';
  const ml = (t: string) => (ambos ? `Mercado Livre: ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);
  const sh = (t: string) => (ambos ? `Shopee: ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);
  const itens: [string, string, boolean, Onde][] = [
    [ml('Vendas brutas, quantidade e unidades'), 'Como nas Métricas do Mercado Livre: pedidos pagos, cancelados e devolvidos, na data de aprovação do pagamento (horário de Brasília). Pedidos cancelados porque o carrinho foi dividido não contam.', false, 'ml'],
    [sh('Vendas brutas, quantidade e unidades'), 'Pedidos pagos (inclusive os em devolução) e os cancelados depois do pagamento, na data do pagamento (horário de Brasília). Pedido cancelado sem pagamento não conta.', false, 'shopee'],
    ['Receita (vendas líquidas)', 'Preço de venda × quantidade dos pedidos pagos. Canceladas e devolvidas não entram na receita, mas as tarifas de frete e de devolução delas entram nos custos.', false, 'todos'],
    [ml('Comissão'), 'Custo por vender e por cobrar do Mercado Livre, como faturados em cada pedido. Isenta desde outubro de 2026 (benefício para ONGs).', false, 'ml'],
    [ml('Frete'), 'Tarifas de envio e de devolução e seus estornos, como faturados. No carrinho com vários pedidos, o frete é cobrado uma vez só. Pedido ainda não faturado usa o custo do envio como estimativa (veja Pontos de atenção).', false, 'ml'],
    [ml('Parcelamento'), 'Taxa de parcelamento cobrada do vendedor.', false, 'ml'],
    [ml('Product Ads e Seguidores'), 'Investimento no dia do consumo, como no painel de Publicidade do Mercado Livre (a fatura cobra na madrugada seguinte). Nos dias cobertos pela API de Ads, vale a API.', false, 'ml'],
    [ml('Estornos de publicidade'), 'Valores de publicidade devolvidos pelo Mercado Livre, no mês do estorno. Reduzem o custo.', false, 'ml'],
    [ml('ICMS-DIFAL e outras tarifas'), 'Da fatura do Mercado Livre: DIFAL, manutenção da Minha página e garantia do programa Decola.', false, 'ml'],
    [sh('Tarifas e frete'), 'Do detalhe de pagamento de cada pedido na Shopee. Comissão = comissão + taxa de serviço + taxa de transação. Outras tarifas = cupom do vendedor, campanhas, processamento, devolução, proteção do frete e reembolsos. Pedido pago cujo pagamento a Shopee ainda não liberou usa a média dos pedidos dos 90 dias anteriores, marcada como estimada. Pedido cancelado depois do pagamento: as tarifas cobradas entram como custo do período.', true, 'shopee'],
    [sh('Ads'), 'Investimento do Shopee Ads no dia, como informado pela Shopee para a loja. Não existem Seguidores, parcelamento nem DIFAL na Shopee.', false, 'shopee'],
    ['Custo dos produtos', 'Cotação de compra do fornecedor no ERP: para N peças vendidas na data D, vale a cotação mais recente até D cuja faixa contém N. Peças = unidades do kit (número após o K no SKU, ex.: K0010 = 10) × quantidade comprada. Sem faixa que contenha N, vale a cotação mais recente até D. Sem cotação até a venda, vale a primeira depois (alerta "cotação posterior"); modelo sem cotação entra com custo zero (alerta "sem custo"). Cada venda usa o custo da época.', true, 'todos'],
    ['Imposto e embalagem', 'Configurados em Administração > Parâmetros de custo, com data de início de vigência; só nos pedidos pagos.', true, 'todos'],
    ['Margem de contribuição', `Receita − todas as tarifas ${canal === 'mercadolivre' ? 'do Mercado Livre' : canal === 'shopee' ? 'da Shopee' : 'do Mercado Livre e da Shopee'} − publicidade − imposto − embalagem − custo dos produtos.`, true, 'todos'],
    ['Por modelo e por SKU', 'Tarifas ligadas ao pedido vão para os itens pelo valor de cada um. Publicidade, DIFAL e outras tarifas sem pedido são rateadas pela receita de cada modelo/SKU no período.', true, 'todos'],
    ['Curva ABC', 'Em ordem decrescente de lucro (ou de receita): A são os itens que somam os primeiros 80%, B os próximos 15% e C o restante. Lucro negativo aparece como prejuízo.', false, 'todos'],
    ['Atualização', `${canal === 'mercadolivre' ? 'Mercado Livre' : canal === 'shopee' ? 'Shopee' : 'Mercado Livre e Shopee'} às 08h, 13h e 17h; custos do ERP às 07:45, 12:45 e 16:45.`, false, 'todos'],
  ];
  const mostra = (o: Onde) => o === 'todos' || (o === 'ml' ? canal !== 'shopee' : canal !== 'mercadolivre');
  return (
    <details className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Como os números são calculados</summary>
      <dl className="mt-3 space-y-2">
        {itens.filter(([, , custo, onde]) => (verCustos || !custo) && mostra(onde)).map(([t, d]) => (
          <div key={t}><dt className="font-medium">{t}</dt><dd className="text-muted">{d}</dd></div>
        ))}
      </dl>
    </details>
  );
}
