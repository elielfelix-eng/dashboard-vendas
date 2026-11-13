# CRM Bitrix24 — Funil, Vendedores e Origens

Data: 13/11/2026 · Status: aguardando revisão do dono · Fase 5 do plano geral (`C:\Users\el_sa\.claude\plans\preciso-criar-um-projeto-cheeky-wreath.md`)

## 1. Objetivo

Trazer os **Leads e Negócios** do Bitrix24 (`https://vocacao.bitrix24.com.br`) para o painel e mostrar o funil, o desempenho de cada vendedor e a origem dos leads. O objetivo é saber onde investir em captação e onde o processo comercial trava. Numa **2ª etapa**, os negócios ganhos são cruzados com o ERP para medir a **margem real**.

### Decisões do dono (13/11/2026)
- O acesso é feito por **webhook de entrada (REST)**, criado por um **usuário técnico dedicado com perfil de CRM somente leitura**.
- O Bitrix usa **Leads** e **Negócios**.
- Os funis e etapas usados são escolhidos **depois que o webhook existir**: listamos o que há no Bitrix e o dono escolhe.
- O cruzamento com o ERP é feito **pelo contato**. O **e-mail é a chave principal**, e o telefone e o CNPJ/CPF servem **apenas para validar**.
- Os vendedores entram **já nesta etapa**, ligados ao usuário do painel **pelo e-mail**.
- A carga inicial traz o **histórico completo**.
- Arquitetura: a mesma do ML. O GitHub Actions sincroniza, o banco calcula (funções SQL `analytics.crm_*`) e a tela só mostra.

## 2. Coleta (conector + job)

**Conector** `packages/connectors/src/bitrix24/` (TypeScript, mesmo padrão do ML):
- Cliente REST lê `BITRIX_WEBHOOK_URL` do ambiente (GitHub Secrets). A URL **nunca** é impressa em log nem gravada em arquivo. Os erros mostram só o método chamado.
- Paginação pelo `start` (50 por página). As várias páginas e entidades vão agrupadas em `batch` (até 50 comandos por chamada).
- Limite de ~2 req/s. Quando chega a resposta `QUERY_LIMIT_EXCEEDED`, o cliente espera e tenta de novo (backoff), como no ML com o 429.
- Métodos usados:

| Método | Dados |
|---|---|
| `crm.lead.list` | ID, TITLE, STATUS_ID, SOURCE_ID, ASSIGNED_BY_ID, DATE_CREATE, DATE_MODIFY, DATE_CLOSED, CONTACT_ID, COMPANY_ID, OPPORTUNITY, EMAIL, PHONE |
| `crm.deal.list` | ID, TITLE, CATEGORY_ID, STAGE_ID, STAGE_SEMANTIC_ID, SOURCE_ID, ASSIGNED_BY_ID, LEAD_ID, CONTACT_ID, COMPANY_ID, OPPORTUNITY, CURRENCY_ID, DATE_CREATE, DATE_MODIFY, CLOSEDATE, CLOSED, campo do motivo de perda (`UF_CRM_*`, a definir) |
| `crm.category.list` (entityTypeId=2) | funis de negócio |
| `crm.status.list` | etapas dos leads (STATUS), etapas de cada funil (DEAL_STAGE*) e origens (SOURCE) |
| `crm.stagehistory.list` (entityTypeId 1 e 2) | entrada em cada etapa, usada para calcular o tempo na etapa e o ciclo |
| `crm.activity.list` | a primeira atividade de cada lead/negócio, usada no tempo até o 1º contato |
| `crm.contact.list` / `crm.company.list` | e-mail, telefone e CNPJ/CPF, usados na 2ª etapa |
| `user.get` | vendedores: ID, nome, e-mail, ativo |

**Job** `jobs/src/sync-bitrix24.ts`, chamado pelo `sync.yml` nos mesmos horários (08h, 13h e 17h BRT):
- **Incremental**, pelo filtro `>DATE_MODIFY` a partir da última execução com sucesso, menos 1 hora de margem.
- **Primeira execução**: carrega todo o histórico.
- **Domingo**: faz uma reconciliação completa. Os IDs que sumiram do Bitrix são marcados `deleted_at` e saem do painel.
- Grava em `core.sync_runs` com o canal `crm`, o que faz o selo "Atualizado às" e o aviso de falha funcionarem como no ML.
- Se a sincronização do Bitrix falhar, **a do ML não é afetada** (são jobs independentes no workflow).

## 3. Banco (migration `0012_crm.sql`)

O schema `crm` já existe desde a 0001. Tabelas, todas com `raw jsonb` e `synced_at`:
- `crm.users` (bitrix_id, nome, email, ativo)
- `crm.pipelines` (category_id, nome)
- `crm.stages` (entidade lead/deal, category_id, status_id, nome, ordem, semântica: em andamento / ganho / perdido)
- `crm.sources` (status_id, nome)
- `crm.leads`, `crm.deals` (com as colunas acima + `deleted_at`)
- `crm.stage_history` (entidade, id do registro, etapa, data de entrada)
- `crm.first_activity` (entidade, id do registro, data da 1ª atividade)
- `crm.contacts`, `crm.companies` (e-mail, telefone e documento normalizados; usados na 2ª etapa)
- `crm.vinculo_vendedor`: exceções da ligação entre o usuário do painel e o usuário do Bitrix, mantida pelo admin. Preenche `core.user_profiles.bitrix_user_id`, que já existe.

**Permissões e RLS**
- Novas permissões em `core.role_permissions`: `crm_funil`, `crm_vendedores` e `crm_origens`. Valores iniciais: admin e gestor com todas, comercial com todas, visualizador sem nenhuma, vendedor com todas.
- `core.my_bitrix_id()` (definer) retorna o `bitrix_user_id` do usuário logado.
- Política nas tabelas `crm.leads` e `crm.deals`: o usuário precisa ver o canal `crm` **e** ou ter perfil diferente de vendedor, ou ser o responsável (`assigned_by_id = (select core.my_bitrix_id())`). O padrão `(select …)` é o mesmo da 0011.
- O vendedor sem ligação não vê nenhum registro.
- O webhook nunca grava no Bitrix. O job só faz leituras.

## 4. Telas (seção **CRM** no menu)

**Barra do topo** no CRM: Período (as mesmas opções do painel) · Funil · Vendedor · Origem, todos na URL. Para o perfil Vendedor, o filtro de vendedor fica fixo nele.

### 4.1 Funil (`/crm/funil`)
- Cartões com a variação em relação ao período anterior:
  - Leads novos
  - % Lead → negócio
  - % Negócio → ganho
  - Valor ganho
  - Ciclo médio (dias da criação ao ganho)
- Gráfico de funil: Leads → Negócios → cada etapa em andamento → Ganhos.
- Tabela por etapa: em aberto, valor em aberto e tempo médio na etapa. A etapa de maior tempo é marcada **"maior gargalo"**.
- Motivos de perda (% dos perdidos no período).

### 4.2 Vendedores (`/crm/vendedores`)
- Ranking com as colunas Leads, Tempo até o 1º contato, Negócios, Ganhos, Perdidos, Conversão, Valor ganho, Ticket médio e "Margem (em breve)". Tem busca e exportação para Excel.
- O perfil Vendedor vê só a própria linha, mais uma linha **"Média da equipe"** sem nomes.
- Os leads e negócios sem responsável aparecem numa linha "Sem responsável".

### 4.3 Origens (`/crm/origens`)
- Colunas: Origem, Leads, % → negócio, % → ganho, Valor ganho, Ticket médio e "Margem (em breve)".

### 4.4 Configurações → Vendedores do CRM (`/configuracoes/vendedores-crm`, admin)
- Lista os usuários do Bitrix com o usuário do painel ligado a cada um, indicando se a ligação é automática (por e-mail) ou manual.
- O admin pode ligar ou desligar manualmente e marcar quem está inativo. O histórico continua contando nos totais.
- O vendedor sem ligação vê o aviso "Seu usuário ainda não está ligado ao Bitrix — fale com o administrador".

### Regras de contagem
- **Leads novos**: lead com a data de criação dentro do período.
- **Conversões (por coorte)**: dos leads criados no período, quantos viraram negócio (por `deal.LEAD_ID`) e quantos desses negócios foram ganhos **até hoje**.
- **Ganhos, perdidos e valor ganho**: negócio com a data de fechamento dentro do período e semântica ganho/perdido.
- **Ticket médio** = valor ganho ÷ ganhos.
- **Tempo até o 1º contato**: da criação do lead até a primeira atividade. Os leads sem atividade contam como "sem contato" e ficam fora da média.
- **Tempo na etapa**: pelo `stage_history`, da entrada na etapa até a entrada na etapa seguinte. Para os registros ainda abertos, conta até agora.
- **Ciclo médio**: da criação do negócio até o fechamento, considerando os ganhos no período.
- **Responsável**: o responsável **atual** do registro no Bitrix.
- Todas as datas são convertidas para o horário de Brasília.
- Os registros com `deleted_at` ficam fora de todas as contagens.

Funções SQL (`analytics.crm_*`, `security invoker`, mesmas regras de desempenho da 0009/0011): `crm_resumo`, `crm_funil`, `crm_etapas`, `crm_motivos_perda`, `crm_vendedores` e `crm_origens`, todas com os parâmetros (de, ate, funil, vendedor, origem).

## 5. Verificação
1. **Testes automáticos** (PGlite, `supabase/tests/crm.test.mjs`): dados de exemplo com o resultado conhecido para cada regra da seção 4, mais RLS com `set role authenticated`. Os casos cobertos:
   - o vendedor A não vê o negócio do vendedor B;
   - o vendedor sem ligação não vê nada;
   - o comercial vê tudo.
2. **Testes do conector** (`node --test`, fetch falso), cobrindo paginação, batch, backoff no limite e a URL ausente de mensagens de erro.
3. **Conferência com o Bitrix**: em um mês fechado, os leads por responsável e os negócios por etapa precisam bater com os relatórios nativos do Bitrix.
4. **Somente leitura**: uma tentativa de gravação pelo webhook precisa ser recusada.
5. **Login como Vendedor**: o vendedor vê só os próprios registros.

## 6. Passos do dono (com guia)
1. Criar o usuário técnico no Bitrix, com o perfil de acesso do CRM **somente leitura**.
2. Com esse usuário, criar o webhook de entrada com os escopos `crm` e `user`.
3. Salvar a URL no GitHub Secrets com o nome `BITRIX_WEBHOOK_URL`. **A URL não deve ser enviada pelo chat.**
4. Rodar o job no modo "listar configuração", que lista os funis, as etapas, as origens e os campos de motivo de perda. Com essa lista, o dono escolhe os funis e o campo do motivo.

## 7. 2ª etapa (fora deste bloco): margem real pelo ERP
- Os negócios ganhos são ligados ao cliente do ERP pelo **e-mail do contato**, normalizado (minúsculas, sem espaços).
- O telefone (só dígitos, sem o DDI 55) e o CNPJ/CPF (só dígitos) servem para validar. Quando eles divergem, o negócio fica marcado "ligação a conferir".
- A margem vem das vendas do ERP para esse cliente a partir da data do ganho, usando a mesma regra de custo por cotação.
- **Depende** das consultas de vendas e de clientes do ERP, que o dono vai fornecer e que também alimentam o canal Brinde do Bem.
- A coluna "Margem (em breve)" passa a ser preenchida.

## 8. Fora do escopo
- Gravar qualquer coisa no Bitrix.
- Produtos dos negócios (`crm.deal.productrows`): ficam para a 2ª etapa, se forem necessários.
- Alertas automáticos por e-mail ou WhatsApp.
