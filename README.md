# Painel de Vendas — Marketplaces + ERP + CRM

Dashboard na nuvem com dados do **Mercado Livre**, **Shopee** (em preparação), **ERP (SQL Server)** e **Bitrix24**.
Atualização automática às **08h, 13h e 17h** (Brasília).

```
apps/web               Site (Next.js) — publicado na Vercel
packages/connectors    Conectores das APIs (Mercado Livre, Shopee)
jobs                   Sincronização — roda no GitHub Actions
supabase/migrations    Estrutura do banco + regras de segurança
.github/workflows      Agendamento (sync.yml) e verificação (ci.yml)
```

---

## Fase 0 — Preparação (passo a passo)

> Ative a **verificação em duas etapas (2FA)** em todas as contas abaixo.

### 1. Instalar o Git no computador
Baixe em https://git-scm.com/download/win e instale com as opções padrão.

### 2. GitHub (guarda o código e roda as atualizações agendadas)
1. Crie a conta em https://github.com/signup.
2. Crie um repositório **privado** chamado `dashboard-vendas` (sem README).
3. Em *Settings > Advanced Security*, ative **Dependabot alerts** e **Dependabot security updates**.
   Se aparecer **Secret Protection / Push protection**, ative também (em conta gratuita com repositório privado normalmente não aparece; nesse caso, o projeto já usa o Gitleaks, que faz essa verificação a cada envio de código).

### 3. Supabase (banco de dados e login)
1. Crie a conta em https://supabase.com e um projeto novo (região **South America (São Paulo)**). Guarde a senha do banco num gerenciador de senhas.
2. Em *SQL Editor > New query*, cole o **conteúdo** (não o nome) de cada arquivo e clique em **Run**, nesta ordem:
   - abra `supabase/migrations/0001_core.sql` no VS Code, **Ctrl+A**, **Ctrl+C**, cole no SQL Editor e clique em **Run** → deve aparecer "Success";
   - em uma **nova query**, faça o mesmo com `supabase/migrations/0002_marketplaces.sql`;
   - depois, do mesmo jeito, `supabase/migrations/0003_regras_v1.sql` (fatura, Ads por campanha, custos por faixa e cálculo de margem).
3. Em *Project Settings > Data API > Exposed schemas*, adicione: `core` e `mkt`.
4. Em *Authentication > Sign In / Providers*, **desative "Allow new users to sign up"** (só entra quem você cadastrar).
5. Em *Authentication > Users > Add user*, crie o seu usuário (e-mail + senha, marque "Auto confirm").
6. Torne-se administrador. No *SQL Editor*, execute (trocando o e-mail):
   ```sql
   update core.user_profiles set role = 'admin'
   where user_id = (select id from auth.users where email = 'seu@email.com.br');
   ```
7. Anote, em *Project Settings*: a **Project URL**, a **anon/publishable key** e a **connection string** do *Transaction pooler* (porta 6543).

### 3.1 Enviar o código para o GitHub (antes da Vercel)
No VS Code, abra o terminal (**Ctrl+'**) e rode (troque `SEU-USUARIO` pelo seu usuário do GitHub):
```
git remote add origin https://github.com/SEU-USUARIO/dashboard-vendas.git
git push -u origin main
```
Na primeira vez abre uma janela de login do GitHub: autorize. Depois, confira no site do GitHub se os arquivos apareceram.

### 4. Vercel (publica o site)
1. Crie a conta em https://vercel.com usando o login do GitHub.
2. *Add New > Project*, escolha o repositório e defina **Root Directory = `apps/web`**.
3. Em *Environment Variables*, cadastre: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`.
4. Depois do primeiro deploy, anote o endereço (ex.: `https://dashboard-vendas.vercel.app`).

### 5. Mercado Livre (app já criado)
Em https://developers.mercadolivre.com.br > *Meus aplicativos* > seu app:
- **Redirect URI**: `https://SEU-SITE.vercel.app/api/oauth/mercadolivre/callback`
- Em **Fluxos OAuth**, marque **Authorization Code** e **Refresh Token** (obrigatório para as atualizações automáticas). Desmarque **Client Credentials** (não é usado).
- Em **PKCE necessário**, marque **pkce**.
- Em **Permissões**, deixe tudo em **Leitura** (inclusive *Publicidade de um produto* e *Venda e envios*).
- Anote o **Client ID** e a **Client Secret**.

### 6. Segredos no GitHub (para as atualizações automáticas)
No repositório: *Settings > Secrets and variables > Actions > New repository secret*:
`DATABASE_URL`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET` e, opcionalmente, `HEALTHCHECK_URL`.

### 7. Shopee (pode iniciar já, pois a aprovação demora)
Cadastre-se em https://open.shopee.com como vendedor/desenvolvedor e solicite um app.

---

## Primeira conexão
1. Acesse o site, entre com seu usuário e abra **Administração > Conexões**.
2. Clique em **Conectar Mercado Livre** e autorize.
3. No GitHub: *Actions > Sincronizacao de dados > Run workflow*. A primeira carga busca 12 meses.

## Segurança — resumo
- Tokens do Mercado Livre ficam **criptografados** (Supabase Vault) e não podem ser lidos pelos usuários do site.
- Senhas e chaves ficam só nos cofres do GitHub e da Vercel. O arquivo `.env` **nunca** vai para o GitHub.
- Cada perfil (Admin, Gestor, Comercial, Visualizador, Vendedor) é aplicado **no banco** (RLS), e não apenas escondido na tela.

## Rodar no computador (opcional, para desenvolvimento)
```
copy .env.example apps\web\.env.local    (e preencha — usado pelo site)
copy .env.example .env                   (e preencha — usado pela sincronização)
npm install
npm run dev                              -> http://localhost:3000
npm run sync                             -> sincronização manual
```
