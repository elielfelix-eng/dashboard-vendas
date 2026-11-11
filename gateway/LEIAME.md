# Gateway do ERP — guia de instalação

O gateway é um programa pequeno que fica numa máquina Windows da sua rede. Três vezes por dia (07:45, 12:45 e 16:45) ele lê dados do seu ERP (SQL Server) e envia para o painel (Supabase). Ele só **envia** dados para fora: não abre nenhuma porta e ninguém consegue "entrar" nele pela internet. No ERP ele usa um usuário que só consegue **ler**.

Hoje ele envia as **faixas de custo dos produtos** (tabela `erp.cost_tiers`).

> Regra de ouro: **nunca** cole senhas em conversas, e-mails ou no arquivo `config.toml`. Senhas são digitadas somente no comando `set-secret`, que as guarda criptografadas.

---

## 1. O que você precisa antes de começar

- Uma máquina **Windows** que fique **ligada** nos horários 07:45, 12:45 e 16:45 (pode ser o próprio servidor do ERP ou outro computador da rede). Se ela estiver desligada num horário, o envio acontece assim que ligar.
- Essa máquina precisa **enxergar o SQL Server** do ERP pela rede e ter acesso à internet.
- O **driver ODBC** do SQL Server instalado: "ODBC Driver 17 for SQL Server" ou "ODBC Driver 18 for SQL Server" (download gratuito no site da Microsoft). Para conferir: menu Iniciar > digite **Fontes de dados ODBC (64 bits)** > aba **Drivers**.
- Alguém com acesso de administrador no SQL Server (o seu DBA ou fornecedor do ERP) e acesso de administrador no Windows da máquina do gateway.
- Acesso ao painel do Supabase do projeto.

---

## 2. Criar o usuário de leitura no SQL Server

Peça ao DBA do ERP (ou faça você mesmo no SQL Server Management Studio):

1. Abra o arquivo `sqlserver\usuario_leitura.sql` (está na pasta do gateway).
2. Troque `NOME_DO_BANCO` pelo nome do banco do ERP e `<SENHA_FORTE>` por uma senha forte que **só o DBA** vai conhecer.
3. Execute o script. Ele cria o usuário `gateway_leitura`, que só tem permissão de **leitura** e só enxerga o schema `painel`.
4. O DBA precisa criar, dentro do schema `painel`, as **views** com os dados que o painel vai ler (por exemplo `painel.faixas_custo`). Use `consultas\faixas_custo.exemplo.sql` como guia do formato.
5. Anote o **nome ou IP do servidor** e o **nome do banco**. Você vai usar no passo 6. A senha, o DBA digita depois (passo 5) ou informa a você de forma segura.

---

## 3. Definir a senha do gateway no Supabase

No Supabase, o papel `gateway_writer` já existe (criado pela migration 0005), mas sem senha. Defina uma:

1. Acesse o painel do Supabase > seu projeto > **SQL Editor** > **New query**.
2. Digite o comando abaixo, trocando `SENHA_FORTE_AQUI` por uma senha forte gerada por você (use um gerenciador de senhas) e clique em **Run**:

   ```sql
   alter role gateway_writer with password 'SENHA_FORTE_AQUI';
   ```
3. **Apague o texto da consulta** depois de executar (não deixe a senha salva no editor).
4. Anote onde achar os dados de conexão: **Project Settings > Database > Connection string > aba "Transaction pooler"**. Você precisa de:
   - **host** (algo como `aws-0-xxxx.pooler.supabase.com`);
   - **porta**: `6543`;
   - **usuário**: `gateway_writer.<project_ref>` — ou seja, `gateway_writer`, um ponto e o código do projeto (o "Project ref", que aparece em Project Settings > General).

---

## 4. Instalar o gateway

Quem prepara o instalador (uma vez) roda `gateway\build.ps1`, que gera `gateway\dist\BrindeGateway.exe`. Depois, na máquina do gateway:

1. Copie a pasta `gateway` para a máquina (ou apenas `install.ps1`, `config.exemplo.toml`, a pasta `consultas` e o `BrindeGateway.exe` na mesma pasta).
2. Clique no menu Iniciar, digite **PowerShell**, clique com o botão direito em **Windows PowerShell** e escolha **Executar como administrador**.
3. Vá até a pasta, por exemplo:

   ```powershell
   cd C:\caminho\da\pasta\gateway
   .\install.ps1
   ```
   Se o Windows reclamar de "execução de scripts desabilitada", use:
   `powershell -ExecutionPolicy Bypass -File .\install.ps1`
4. Ao final ele mostra os próximos passos. O instalador:
   - copia o programa para `C:\Program Files\BrindeGateway\`;
   - cria a pasta `C:\ProgramData\BrindeGateway\` (configuração, logs e senhas), acessível só pelo sistema e por administradores;
   - cria um `config.toml` de exemplo (se ainda não existir);
   - cria a tarefa agendada **BrindeGateway** (07:45, 12:45 e 16:45, todos os dias).

---

## 5. Guardar as senhas (comando `set-secret`)

No mesmo PowerShell de administrador:

```powershell
& "C:\Program Files\BrindeGateway\BrindeGateway.exe" set-secret sqlserver
& "C:\Program Files\BrindeGateway\BrindeGateway.exe" set-secret supabase
```

- No primeiro, digite a senha do usuário `gateway_leitura` (passo 2).
- No segundo, digite a senha do `gateway_writer` (passo 3).
- Ao digitar, **nada aparece na tela** — é normal. Digite e aperte Enter.
- As senhas ficam criptografadas e só funcionam nesta máquina.

---

## 6. Editar o arquivo de configuração

1. Abra o **Bloco de Notas como administrador** (menu Iniciar > digite "Bloco de Notas" > botão direito > Executar como administrador).
2. Menu **Arquivo > Abrir** e digite `C:\ProgramData\BrindeGateway\config.toml`.
3. Ajuste:
   - em `[source]`, `connection_string`: troque `NOME-OU-IP-DO-SERVIDOR`, `NOME_DO_BANCO` e, se necessário, o número do driver (17 ou 18). **Não coloque a senha** aqui;
   - em `[target]`: `host`, e `user` (`gateway_writer.<project_ref>`). A porta fica `6543`.
4. Salve o arquivo.

Agora a consulta das faixas de custo:

1. Em `C:\ProgramData\BrindeGateway\consultas\` já existe `faixas_custo.exemplo.sql`.
2. Copie para `faixas_custo.sql` (mesma pasta) e peça ao DBA para trocar os trechos marcados com `-- TROCAR:` pelas tabelas/views reais do ERP.
3. A consulta precisa devolver exatamente as colunas: `product_id` (modelo do produto, igual ao modelo do SKU do Mercado Livre), `qty_start`, `qty_end`, `price`, `created_at`, `expired_at`.

---

## 7. Testar

```powershell
& "C:\Program Files\BrindeGateway\BrindeGateway.exe" test
```

O teste **não grava nada**. Ele mostra:

```
Supabase: conexao OK
ERP: conexao OK
  faixas_custo: 1234 linhas; colunas: product_id, qty_start, ...
```

Se algo falhar, veja a seção "Problemas comuns" abaixo.

Para enviar de verdade agora, sem esperar o horário:

```powershell
Start-ScheduledTask -TaskName BrindeGateway
```

### Conferir no painel

No Supabase > **SQL Editor**, execute:

```sql
select started_at, status, stats, error
from core.sync_runs
where source = 'erp'
order by started_at desc
limit 5;
```

A linha mais recente deve estar com `status = success` e, em `stats`, o número de linhas enviadas por consulta.

---

## 8. Onde ficam os logs

`C:\ProgramData\BrindeGateway\logs\gateway.log` (um arquivo por dia, os últimos 30 dias são mantidos). Os logs não contêm senhas. Para ver a tarefa agendada: menu Iniciar > **Agendador de Tarefas** > **Biblioteca do Agendador de Tarefas** > **BrindeGateway** (coluna "Resultado da última execução").

---

## 9. Atualizar para uma versão nova

Gere o novo `BrindeGateway.exe` (`build.ps1`) e rode `.\install.ps1` de novo como administrador. Ele troca o programa e recria a tarefa, **sem apagar** o `config.toml`, as senhas e os logs.

## 10. Desinstalar

PowerShell como administrador, na pasta `gateway`:

```powershell
.\uninstall.ps1
```

Remove a tarefa e o programa. Ele pergunta se também quer apagar a pasta `C:\ProgramData\BrindeGateway` (configuração, senhas e logs); a resposta padrão é **não** (manter).

---

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| `Configuracao invalida: ...` | O `config.toml` tem um erro. A mensagem diz qual campo. Corrija e rode `test` de novo. |
| `Arquivo 'query_file' ... nao encontrado` | Falta o arquivo `faixas_custo.sql` em `C:\ProgramData\BrindeGateway\consultas\` (passo 6). |
| `Supabase: falha - ...` | Confira host, porta `6543`, usuário `gateway_writer.<project_ref>` e a senha (refaça `set-secret supabase`). Confirme também que esta máquina tem internet. |
| `Segredo ... nao encontrado` | Falta rodar o `set-secret` (passo 5) — rode como administrador, na mesma máquina. |
| `ERP: falha - ...` (login failed) | Senha do `gateway_leitura` errada (refaça `set-secret sqlserver`) ou usuário não criado. |
| `ERP: falha - ...` (driver / "Data source name not found") | Driver ODBC não instalado ou nome do driver diferente no `connection_string` (17 ou 18). |
| `ERP: falha - ...` (servidor não encontrado / timeout) | Nome/IP do servidor errado, firewall bloqueando a porta 1433 ou máquina fora da rede do ERP. |
| `ERP: falha - ...` (certificado SSL) | Mantenha `TrustServerCertificate=yes` no `connection_string`. |
| `faixas_custo: falha - ...` | Erro na consulta SQL (nome de tabela/coluna errado) ou o usuário sem permissão no schema `painel`. Peça ao DBA. |
| A tarefa não rodou no horário | A máquina estava desligada (ela roda ao ligar), ou veja o "Resultado da última execução" no Agendador de Tarefas e o arquivo de log. |

Códigos de saída do programa (aparecem no Agendador de Tarefas): `0` = tudo certo; `1` = alguma consulta falhou ou erro inesperado; `2` = não foi possível conectar ao Supabase ou a configuração é inválida.
