# Cadastro próprio do vendedor — plano de implementação

> Spec: `docs/superpowers/specs/2026-11-27-cadastro-vendedor-design.md` (aprovado).
> Ramo: `005-cadastro-vendedor`. Não mesclar ao `main` sem autorização do dono.

**Objetivo:** o vendedor cria a própria conta com o e-mail do Bitrix24, desde que o e-mail seja do domínio da empresa e esteja ativo em `crm.users`. A conta nasce com perfil `vendedor` e canal `crm`.

**Arquitetura:** a elegibilidade é decidida no banco (função `security definer`). A rota de servidor usa a chave de administração do Supabase, só no servidor, para enviar o convite. O trigger de criação de perfil aplica o perfil vendedor apenas quando a marca `origem = 'cadastro_proprio'` estiver presente.

**Restrições globais:**
- Nenhuma chave de administração no navegador, no repositório ou em logs.
- Logs com rótulos e códigos de erro, nunca com e-mail completo.
- Mensagem de resposta idêntica para e-mail elegível e não elegível.
- Não alterar números, telas por perfil ou permissões existentes.

---

### Tarefa 1: Migration de elegibilidade e trigger

**Arquivos:**
- Criar: `supabase/migrations/0038_cadastro_vendedor.sql`
- Testar: `supabase/tests/cadastro-vendedor.test.mjs`
- Alterar: `package.json` (incluir o teste em `test:sql`)

**Interface produzida:**
- `core.pode_cadastrar_vendedor(p_email text) returns boolean`: verdadeiro só se o domínio for `brindedobem.com.br` e existir em `crm.users` um registro com o mesmo e-mail (sem diferenciar maiúsculas) e `ativo = true`. Execução concedida apenas ao papel `service_role`.
- `core.handle_new_user()` atualizado: se `raw_user_meta_data ->> 'origem' = 'cadastro_proprio'` e `core.pode_cadastrar_vendedor(new.email)`, grava `role = 'vendedor'` e `channels = array['crm']`. Caso contrário, mantém o comportamento atual.

**Passos:**
- [ ] Escrever o teste com os casos: elegível vira vendedor com canal crm; inativo não; outro domínio não; e-mail em maiúsculas é aceito; cadastro sem a marca de origem continua visualizador.
- [ ] Rodar o teste e confirmar que falha (a função ainda não existe).
- [ ] Criar a migration, reexecutável (`create or replace`, `drop trigger if exists`).
- [ ] Rodar `npm run test:sql` e confirmar que tudo passa.

---

### Tarefa 2: Regras puras de e-mail

**Arquivos:**
- Criar: `apps/web/lib/cadastro-vendedor.ts`
- Testar: `apps/web/lib/cadastro-vendedor.test.ts`

**Interface produzida:**
- `normalizarEmail(texto: string): string`: remove espaços e põe em minúsculas.
- `emailValido(email: string): boolean`: formato simples, com `@` e domínio.

**Passos:**
- [ ] Escrever o teste: espaços e maiúsculas são normalizados; e-mails sem `@` ou sem domínio são inválidos.
- [ ] Rodar e ver falhar.
- [ ] Implementar e rodar `npm run test:web`.

---

### Tarefa 3: Rota de servidor e cliente administrativo

**Arquivos:**
- Criar: `apps/web/lib/supabase/admin.ts` (cliente com `SUPABASE_SERVICE_ROLE_KEY`, marcado `server-only`)
- Criar: `apps/web/app/cadastro/actions.ts` (server action `solicitarCadastro`)

**Comportamento de `solicitarCadastro(formData)`:**
1. Normaliza e valida o e-mail. Se inválido, devolve a mensagem genérica.
2. Chama `core.pode_cadastrar_vendedor` com o cliente administrativo.
3. Se elegível, chama `auth.admin.inviteUserByEmail(email, { data: { origem: 'cadastro_proprio' }, redirectTo: <origem>/definir-senha })`.
4. Em qualquer caso, devolve a mesma mensagem: "Se o e-mail estiver cadastrado, você receberá um link em instantes."
5. Erros são registrados só com rótulo, por exemplo `cadastro: falha_convite`, sem o e-mail.

**Passos:**
- [ ] Escrever teste unitário para a parte de decisão (função que recebe o resultado da elegibilidade e devolve a ação), sem rede.
- [ ] Implementar `admin.ts` e a action.
- [ ] Conferir com `npm run typecheck`.

---

### Tarefa 4: Páginas `/cadastro` e `/definir-senha`

**Arquivos:**
- Criar: `apps/web/app/cadastro/page.tsx`
- Criar: `apps/web/app/definir-senha/page.tsx`
- Alterar: `apps/web/middleware.ts` (liberar `/cadastro` e `/definir-senha` sem login)
- Alterar: `apps/web/app/login/page.tsx` (link "Primeiro acesso do vendedor")

**Passos:**
- [ ] Página de cadastro: campo de e-mail e botão, usando a identidade do login (logotipo, faixa lima).
- [ ] Página de definir senha: lê a sessão do convite, pede a senha nova, chama `updateUser({ password })` e leva ao painel.
- [ ] Ajustar o middleware e testar manualmente que as duas páginas abrem sem login e que as outras continuam exigindo login.

---

### Tarefa 5: Aviso ao administrador

**Arquivos:**
- Criar em `supabase/migrations/0038_cadastro_vendedor.sql`: tabela `core.cadastros_proprios (email text, criado_em timestamptz default now())`, legível só por admin.
- Alterar `solicitarCadastro`: registra o e-mail elegível nessa tabela após o convite.
- Alterar `apps/web/app/(app)/configuracoes/permissoes/page.tsx`: lista dos últimos cadastros próprios.

**Decisão a confirmar com o dono:** aviso por tela (recomendado, sem e-mail extra) ou por e-mail ao admin.

**Passos:**
- [ ] Teste SQL: só admin lê a tabela.
- [ ] Implementar a gravação e a lista.

---

### Tarefa 6: Configuração (dono)

- [ ] Vercel: adicionar `SUPABASE_SERVICE_ROLE_KEY` **somente** para Production e Preview, marcada como secreta. Depois, Redeploy.
- [ ] Supabase > Authentication: confirmar que o **Site URL** é o domínio atual e que `…/definir-senha` está nas **Redirect URLs**.
- [ ] Supabase > Authentication > Emails: testar o envio do convite. Se houver limite baixo, decidir se configura um serviço de e-mail próprio.

---

### Tarefa 7: Verificação final

- [ ] `npm run typecheck`, `npm run test:web`, `npm run test:sql` e `npm run build`, todos passando.
- [ ] Teste manual com um e-mail elegível, um inativo e um de outro domínio: a mensagem na tela deve ser idêntica nos três casos.
- [ ] Conferir a Allison e a Cristina: perfil `vendedor`, canal `crm`, e a tela de Funil mostrando só os próprios negócios.
- [ ] Revisão de segurança: a chave de administração não aparece no bundle do navegador (buscar no build) e não aparece em logs.

---

## Pontos que dependem do dono

1. Autorizar a variável `SUPABASE_SERVICE_ROLE_KEY` na Vercel.
2. Confirmar o aviso ao administrador: tela ou e-mail.
3. Autorizar o envio de e-mail do Supabase (limite e, se necessário, serviço próprio).
4. Autorizar o merge do ramo `005-cadastro-vendedor` no `main`, depois da verificação.
