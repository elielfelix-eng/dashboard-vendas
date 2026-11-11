# Plano — Fase 3: Gateway do ERP (SQL Server → Supabase)

Spec: `C:\Users\el_sa\.claude\plans\preciso-criar-um-projeto-cheeky-wreath.md` (seções "Arquitetura", "Segurança" item 5, "Fases" item 3) e `.claude/skills/dashboard-mercado-livre-brinde-do-bem/regras-de-negocio.md` (seção "Custo do produto").

## Contexto
O ERP próprio (SQL Server, ligado 24h, acessível por ODBC na rede local) guarda custos, estoque, notas e financeiro. Um programa ("gateway") roda numa **outra máquina da rede Windows**, lê consultas SQL e envia o resultado ao Postgres do Supabase (schema `erp`), 3x ao dia (07:45, 12:45, 16:45). As tabelas do ERP **ainda não são conhecidas**: o gateway é **guiado por configuração** (cada "dataset" = uma consulta SQL + tabela de destino). O único destino já definido é `erp.cost_tiers` (migration 0003).

## Global Constraints
1. Mensagens ao usuário, logs e documentação em **português do Brasil**. Identificadores de código podem ser em inglês.
2. **Nunca** registrar em log, exceção ou saída: senhas, connection strings completas ou conteúdo de segredos. Ao mostrar uma connection string, mascarar `PWD=`/`password=`.
3. Python compatível com **3.12+** (não usar sintaxe exclusiva de 3.13+). Dependências de execução: somente `psycopg[binary]>=3.2` e `pyodbc>=5` (mais a stdlib, incluindo `tomllib`). Teste: `pytest`.
4. O gateway só faz conexões **de saída**. Nada de servidor/porta escutando.
5. Conexão ao Supabase: `sslmode=require` em produção; a sessão define `SET TIME ZONE 'America/Sao_Paulo'` logo após conectar (datas do ERP vêm sem fuso e são horário de Brasília).
6. Escrita no destino de um dataset é **atômica**: apaga as linhas daquele dataset e insere as novas **na mesma transação**; em erro, rollback e as linhas antigas permanecem.
7. Em `erp.cost_tiers`, o gateway só apaga/insere linhas com `source = 'erp'`; linhas com outro `source` (ex.: `manual`, `csv`) nunca são tocadas.
8. Registro de execução em `core.sync_runs` com `source = 'erp'` (status `running` → `success`/`error`, `stats` jsonb com linhas por dataset, `error` com mensagem sem segredos).
9. Migrations SQL **idempotentes** (podem rodar mais de uma vez) e nunca contêm senhas.
10. Testes que devem passar ao final de cada task: `npm run test:sql` (raiz) e, a partir da Task 2, `gateway/.venv/Scripts/python.exe -m pytest gateway/tests -q`.
11. Ambiente local: Windows, PowerShell; Git em `C:\Program Files\Git\cmd\git.exe`; venv já criado em `gateway/.venv` com psycopg, pyodbc, keyring e pytest instalados (keyring NÃO deve ser usado). Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 1 — Migration 0005: papel `gateway_writer` + teste de permissões

**Arquivos:** criar `supabase/migrations/0005_gateway.sql`; criar `supabase/tests/stubs.sql`; alterar `supabase/tests/regras-v1.test.mjs` (passar a carregar `stubs.sql` em vez do bloco inline de stubs); criar `supabase/tests/gateway-permissoes.test.mjs`; alterar `package.json` raiz (script `test:sql` roda os dois arquivos de teste, falhando se qualquer um falhar).

**0005_gateway.sql** (idempotente):
- Criar o papel `gateway_writer` com `LOGIN` se não existir (bloco `DO` checando `pg_roles`). **Sem senha** no arquivo — comentário explicando que o admin define com `alter role gateway_writer with password '...'` no SQL Editor.
- `grant usage on schema erp, core to gateway_writer`.
- Em `erp`: `select, insert, update, delete` em todas as tabelas; `usage, select` em todas as sequences; `alter default privileges in schema erp` para tabelas e sequences futuras com os mesmos privilégios.
- Política RLS em `erp.cost_tiers` para `gateway_writer`: `for all` com `using (source = 'erp') with check (source = 'erp')` (`drop policy if exists` antes).
- `core.sync_runs`: `grant select, insert, update` + `usage` na sequence `core.sync_runs_id_seq`; política RLS `for all to gateway_writer using (source = 'erp') with check (source = 'erp')`.
- Nenhum acesso a `mkt`, `auth`, `vault`, `core.oauth_tokens`.

**stubs.sql:** o mesmo conteúdo de stubs hoje inline em `regras-v1.test.mjs` (papéis `authenticated`, `anon`, `service_role`; schema `auth` + `auth.uid()`; schemas `core`, `mkt`, `erp`, `analytics`, `config`, `map`, `crm`; `core.accounts`; tipo `core.app_role`; funções `core.can_see_channel`, `core.can_see_costs`, `core.my_role`) **mais** a tabela `core.sync_runs` idêntica à de `0001_core.sql` (com RLS habilitado e a política de select para `authenticated`).

**gateway-permissoes.test.mjs** (PGlite em memória, mesmo estilo de asserts do teste existente): aplica stubs + 0002 + 0003 + 0005 + **0005 de novo** (idempotência) e verifica, com `set role gateway_writer`:
- consegue inserir em `erp.cost_tiers` com `source='erp'`; **não** consegue inserir com `source='manual'` (erro de RLS);
- `delete from erp.cost_tiers` apaga só linhas `source='erp'` (inserir antes, como superusuário, uma linha `manual` e conferir que ela continua);
- consegue `insert` e `update` em `core.sync_runs` com `source='erp'`; não consegue inserir com `source='mercadolivre'`;
- **não** consegue `select` em `mkt.orders` (erro de permissão);
- uma tabela criada depois em `erp` (ex.: `create table erp.teste(x int)` como superusuário) é gravável pelo `gateway_writer` (default privileges).
Usar `reset role` entre blocos. O processo sai com código ≠ 0 se algum assert falhar.

---

## Task 2 — Pacote do gateway: configuração, segredos e leitura do ERP

**Arquivos:** criar `gateway/pyproject.toml`, `gateway/src/brinde_gateway/__init__.py`, `config.py`, `secrets.py`, `source.py`, `gateway/tests/conftest.py`, `gateway/tests/test_config.py`, `gateway/tests/test_secrets.py`, `gateway/tests/test_source.py`. O pacote deve ser importável nos testes sem instalação (ex.: `conftest.py` adiciona `gateway/src` ao `sys.path`, ou `pythonpath` no `pyproject.toml` via `[tool.pytest.ini_options]`).

**config.py** — `load_config(path) -> Config` lendo TOML (`tomllib`). Estrutura:
```toml
[source]
connection_string = "DSN=ERP;UID=gateway_leitura"   # sem senha; a senha vem do segredo "sqlserver" (acrescentada como PWD=)
# ou: odbc_dsn = "ERP"  (equivale a "DSN=ERP")

[target]
host = "aws-0-sa-east-1.pooler.supabase.com"
port = 6543
dbname = "postgres"
user = "gateway_writer.<project_ref>"
sslmode = "require"          # padrão "require"
# a senha vem do segredo "supabase"

[healthcheck]                # opcional
url = "https://hc-ping.com/..."

[[datasets]]
name = "faixas_custo"                 # [a-z0-9_]+, único
target_table = "erp.cost_tiers"       # schema.tabela; schema DEVE ser "erp"
mode = "replace_source"               # "replace_source" (apaga/insere só source='erp'; injeta coluna source='erp') ou "replace_all" (apaga tudo da tabela)
query = "select ... as product_id, ..."   # ou query_file = "consultas/faixas.sql" (relativo ao arquivo de config)
```
Dataclasses `Config`, `SourceConfig`, `TargetConfig`, `Dataset`. Validações com `ConfigError` (mensagem em português, citando o campo): campos obrigatórios; `name` válido e único; `target_table` no formato `erp.<nome>` (só `[a-z0-9_]`); `mode` válido; exatamente um entre `query`/`query_file`; `query_file` existe; pelo menos um dataset. `source` exige `connection_string` ou `odbc_dsn` (não ambos).

**secrets.py** — `get_secret(name) -> str`, `set_secret(name, value)`, `SecretMissing`. Nomes válidos: `sqlserver`, `supabase`.
- Ordem de leitura: variável de ambiente `BRINDE_GATEWAY_<NOME_MAIUSCULO>` (para testes/CI); depois arquivo protegido.
- Arquivo: `%PROGRAMDATA%\BrindeGateway\secrets.json` (diretório sobrescrevível por `BRINDE_GATEWAY_HOME`), com JSON `{nome: base64(blob)}` onde blob = **DPAPI escopo de máquina** (`CryptProtectData` com `CRYPTPROTECT_LOCAL_MACHINE`, via `ctypes`, sem pywin32). `set_secret` cria o diretório e grava. Fora do Windows, `set_secret` e a leitura de arquivo levantam erro claro (só env var funciona).
- `SecretMissing` com mensagem orientando: `BrindeGateway.exe set-secret <nome>`.
- Nunca incluir o valor do segredo em mensagens.

**source.py** — `fetch(dataset, conn) -> (columns: list[str], rows: list[tuple])` executando a consulta do dataset num objeto conexão DB-API (cursor/description/fetchall; nomes de coluna em minúsculas). `connect_source(source_cfg)` monta a connection string (`DSN=...` ou a configurada), acrescenta `PWD=<segredo sqlserver>` **apenas se** o segredo existir e a string não tiver `PWD=`/`Trusted_Connection=yes`, e chama `pyodbc.connect(..., readonly=True, timeout=30)`. `mask(conn_str)` substitui o valor de `PWD=`/`Password=` por `***`.

**Testes** (sem SQL Server real):
- config: arquivo válido completo; cada erro de validação acima (um teste por regra relevante); `query_file` relativo.
- secrets: env var tem prioridade; `SecretMissing` quando ausente (com `BRINDE_GATEWAY_HOME` apontando para `tmp_path`); no Windows, roundtrip `set_secret`/`get_secret` em `tmp_path` e o arquivo **não** contém o texto do segredo em claro (pular fora do Windows).
- source: `fetch` com `sqlite3.connect(':memory:')` como conexão (colunas em minúsculas, tipos preservados); `mask` cobre `PWD=x;` e `Password=x` no fim da string; `connect_source` monta a string certa (monkeypatch de `pyodbc.connect` capturando o argumento) nos casos DSN, connection_string com e sem segredo, e não duplica `PWD`.

---

## Task 3 — Escrita no Supabase, execução completa e linha de comando

**Arquivos:** criar `gateway/src/brinde_gateway/target.py`, `runner.py`, `cli.py`, `__main__.py`; `gateway/tests/pg_server.mjs`; `gateway/tests/test_target.py`, `test_runner.py`, `test_cli.py`; alterar `gateway/tests/conftest.py`; adicionar `@electric-sql/pglite-socket` como devDependency do workspace `jobs` (mesmo lugar do `@electric-sql/pglite`) e atualizar `package-lock.json`.

**target.py**
- `connect_target(target_cfg, password) -> psycopg.Connection` (autocommit desligado), `SET TIME ZONE 'America/Sao_Paulo'` logo após conectar; `application_name='brinde-gateway'`; `connect_timeout=30`.
- `write_dataset(conn, dataset, columns, rows) -> int`:
  1. Lê as colunas da tabela destino em `information_schema.columns`. Se alguma coluna da consulta não existir na tabela → `DatasetError` listando as colunas desconhecidas (português). Em `replace_source`, a coluna `source` não pode vir da consulta (é injetada) e a tabela precisa ter `source`.
  2. Numa transação: `replace_source` → `delete from <tabela> where source = 'erp'`; `replace_all` → `delete from <tabela>`. Depois insere todas as linhas (injetando `source='erp'` em `replace_source`) usando `COPY ... FROM STDIN` (psycopg `cursor.copy`) ou `executemany` em lotes. Identificadores via `psycopg.sql.Identifier` (nunca concatenar strings).
  3. Commit; em qualquer erro, rollback e relança. Retorna o nº de linhas inseridas.

**runner.py** — `run(config, *, source_connect=..., target_connect=..., get_secret=..., ping=...) -> int` (dependências injetáveis para teste):
- Conecta no destino; insere `core.sync_runs (source='erp', status='running')` e faz commit (o registro existe mesmo se tudo falhar depois).
- Para cada dataset: busca no ERP e grava; erros de um dataset não impedem os demais; `stats[name] = linhas` ou `stats[name] = -1` e acumula a mensagem de erro (sem segredos).
- Atualiza o `sync_runs`: `success` se nenhum dataset falhou, senão `error` com as mensagens; `finished_at = now()`; `stats` jsonb.
- Healthcheck opcional: ping `url + '/start'` no início, `url` no sucesso, `url + '/fail'` na falha (timeout 10 s; falha do ping nunca derruba a execução).
- Retorna 0 em sucesso, 1 se algum dataset falhou, 2 se não conseguiu conectar no destino.
- Logs em português (módulo `logging`), sem segredos.

**cli.py / __main__.py** — `python -m brinde_gateway <comando>` (e o futuro exe):
- `run [--config CAMINHO]` — padrão do config: `%PROGRAMDATA%\BrindeGateway\config.toml` (ou `BRINDE_GATEWAY_HOME`). Log em arquivo `<home>\logs\gateway.log` (rotação diária, 30 arquivos) e no console.
- `test [--config]` — testa as duas conexões e, para cada dataset, executa a consulta e mostra nº de linhas e colunas (não grava nada).
- `set-secret NOME` — lê o valor com `getpass` (não ecoa) e grava com `set_secret`.
- Códigos de saída iguais aos do `run`.

**Testes** (PGlite real via socket):
- `pg_server.mjs`: sobe PGlite + `PGLiteSocketServer` em `127.0.0.1` numa porta recebida por argumento, aplica `supabase/tests/stubs.sql` + `0002` + `0003` + `0005`, define a senha não é necessária (PGlite aceita qualquer), imprime `pronto` e roda até ser morto.
- `conftest.py`: fixture `pg` (escopo de sessão) que inicia o servidor com `node`, espera `pronto`, devolve parâmetros de conexão (`sslmode=disable`); e um fixture por teste que limpa `erp.cost_tiers` e `core.sync_runs`. Pular os testes de integração com mensagem clara se `node` não estiver disponível.
- target: grava em `erp.cost_tiers` com `replace_source` preservando linha `manual`; segunda gravação substitui (não duplica); coluna desconhecida → `DatasetError`; erro no meio (ex.: valor nulo em `price`) → rollback mantém as linhas antigas; datetime sem fuso `2026-10-01 00:00` é gravado como `2026-10-01 03:00+00`.
- runner: ERP simulado com `sqlite3` contendo uma tabela de faixas; um dataset válido e um com consulta inválida → `stats` com linhas e `-1`, status `error`, retorno 1, e o dataset válido gravado; tudo válido → `success`, retorno 0; ping chamado com `/start` e sucesso/falha (função injetada).
- cli: `set-secret` com `getpass` simulado grava via `set_secret` (monkeypatch); `run` com config inexistente → mensagem em português e código ≠ 0.

---

## Task 4 — Empacotamento, instalação agendada, documentação e CI

**Arquivos:** criar `gateway/build.ps1`, `gateway/install.ps1`, `gateway/uninstall.ps1`, `gateway/config.exemplo.toml`, `gateway/consultas/faixas_custo.exemplo.sql`, `gateway/sqlserver/usuario_leitura.sql`, `gateway/LEIAME.md`; alterar `.github/workflows/ci.yml` (job de testes do gateway), `.gitignore` (ignorar `gateway/.venv/`, `gateway/build/`, `gateway/dist/`, `*.spec` gerado — conferir o que já existe), `README.md` (seção curta "Fase 3 — Gateway do ERP" apontando para `gateway/LEIAME.md`) e a skill `.claude/skills/dashboard-mercado-livre-brinde-do-bem/SKILL.md` (seção ERP: como o gateway funciona, arquivos, comandos, status da fase).

- `build.ps1`: cria/usa `gateway/.venv`, instala dependências + `pyinstaller`, gera `gateway/dist/BrindeGateway.exe` (onefile, console) a partir de `brinde_gateway/__main__.py`.
- `install.ps1` (exige administrador; verifica e avisa em português): copia o exe para `C:\Program Files\BrindeGateway\`, cria `%PROGRAMDATA%\BrindeGateway\` (config, logs, segredos) com ACL restrita a SYSTEM e Administradores, copia `config.exemplo.toml` como `config.toml` se ainda não existir, e registra a tarefa agendada **"BrindeGateway"** executando `BrindeGateway.exe run` como **SYSTEM** às **07:45, 12:45 e 16:45** diariamente, com "executar o quanto antes se um horário for perdido" e limite de 1 hora. Ao final, imprime os próximos passos (set-secret, test). Idempotente (reinstalar atualiza o exe e a tarefa sem apagar config/segredos).
- `uninstall.ps1`: remove a tarefa e o exe; pergunta antes de apagar `%PROGRAMDATA%\BrindeGateway` (padrão: manter).
- `config.exemplo.toml`: exemplo comentado em português com o dataset `faixas_custo` (`erp.cost_tiers`, `replace_source`, `query_file = "consultas/faixas_custo.sql"`).
- `consultas/faixas_custo.exemplo.sql`: modelo de SELECT com os aliases exigidos (`product_id`, `qty_start`, `qty_end`, `price`, `created_at`, `expired_at`) e comentários `-- TROCAR:` onde entram as tabelas reais do ERP.
- `sqlserver/usuario_leitura.sql`: modelo T-SQL para o DBA criar o login `gateway_leitura` (senha como placeholder `<SENHA_FORTE>`), usuário no banco e permissão **somente SELECT** num schema `painel` onde ficarão as views do painel (com `CREATE SCHEMA painel` se não existir e comentários).
- `LEIAME.md`: guia passo a passo para leigo (português): pré-requisitos (máquina Windows ligada nos horários, acesso ao SQL Server, driver ODBC 17/18), criar usuário de leitura no SQL Server, definir a senha do `gateway_writer` no Supabase (`alter role ... with password`, usuário de conexão `gateway_writer.<project_ref>`, porta 6543), instalar, `set-secret sqlserver`, `set-secret supabase`, editar `config.toml`, `test`, conferir em `core.sync_runs`, onde ficam os logs, como atualizar e desinstalar, e solução de problemas comuns.
- CI: novo job `gateway` em `ubuntu-latest`: setup-python 3.12, setup-node 22, `npm ci`, `pip install "psycopg[binary]" pyodbc pytest`, `sudo apt-get install -y unixodbc` se necessário para importar pyodbc, `python -m pytest gateway/tests -q`.

Verificação da Task 4: `npm run test:sql` e pytest passam; `build.ps1` gera o exe e `dist/BrindeGateway.exe --help` (ou `test` com config de exemplo inválida) mostra mensagem em português sem stack trace; `install.ps1` **não** é executado (exige admin e altera a máquina) — apenas validado com `powershell -NoProfile -Command "& { [ScriptBlock]::Create((Get-Content gateway/install.ps1 -Raw)) | Out-Null }"` (parse sem erros).
