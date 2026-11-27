# Cadastro próprio do vendedor, validado pelo Bitrix24

Data: 2026-11-27. Status: aprovado pelo dono (três recomendações aceitas).

## Intenção

O vendedor cria o próprio acesso ao painel com o e-mail que usa no Bitrix24, sem depender de o administrador criar a conta no Supabase uma a uma.

## Objetivos

- Só quem tem um usuário **ativo** em `crm.users` (sincronizado do Bitrix) com e-mail do domínio da empresa pode se cadastrar sozinho.
- Quem se cadastra recebe **só** o perfil `vendedor`, com canal `crm`.
- Prova de posse: a pessoa só cria a senha pelo link enviado ao e-mail.
- O administrador é avisado de cada cadastro.

## Não objetivos

- Não cria perfis de administrador, gestor ou comercial.
- Não altera nenhuma tela de números, nem as regras de permissão já existentes.
- Não abre o cadastro público do Supabase.

## Abordagem

1. **Página pública `/cadastro`** com um campo de e-mail.
2. **Rota de servidor** que:
   - confere se o e-mail termina em `@brindedobem.com.br` (domínio configurável) e se existe em `crm.users` com `ativo = true`, por meio de uma função `security definer` que só devolve sim ou não;
   - se for elegível, chama a API de administração do Supabase (`inviteUserByEmail`) com `data: { origem: 'cadastro_proprio' }`;
   - responde **sempre** com a mesma mensagem, para não revelar quais e-mails existem.
3. **Trigger de criação de perfil** (`core.handle_new_user`): quando `origem = 'cadastro_proprio'` e o e-mail é elegível, grava `role = 'vendedor'` e `channels = {'crm'}`. Sem essa marca, o comportamento atual não muda.
4. **Aviso ao administrador:** registro em `core.sync_runs` ou tela de Usuários, mais um e-mail, se o envio estiver configurado.

## Decisões tomadas

- Só o perfil vendedor é aberto a cadastro próprio (recomendação aprovada).
- Domínio `@brindedobem.com.br` obrigatório, além de existir no Bitrix (aprovado).
- Administrador avisado a cada cadastro (aprovado).
- Canal único `crm`: o vendedor não vê Marketplaces nem custos. É uma escolha minha, a confirmar.

## Pontos que exigem autorização do dono

- Adicionar a chave de administração do Supabase (`SUPABASE_SERVICE_ROLE_KEY`) como variável de ambiente **só no servidor** da Vercel. Ela nunca vai ao navegador nem ao repositório.
- Migration nova com a função de elegibilidade e o ajuste do trigger.
- Configurar o envio de e-mail do Supabase; o modo padrão tem limite baixo de envios por hora.

## Verificação

- Teste SQL: e-mail elegível vira vendedor com canal crm; e-mail inelegível, inativo ou de outro domínio não ganha perfil de vendedor; cadastro sem a marca de origem mantém o comportamento atual.
- Teste manual: cadastro com um e-mail elegível e outro não elegível; a mensagem deve ser igual nos dois casos.
- Conferir com a Allison e a Cristina: o perfil delas deve ser vendedor, com canal crm.

## Observação imediata

Contas criadas pelo administrador no Supabase nascem como **visualizador**. A Allison precisa ter o perfil alterado para `vendedor` antes do teste de tela.
