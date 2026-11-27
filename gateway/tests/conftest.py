import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import psycopg
import pytest

SRC = str(Path(__file__).resolve().parents[1] / "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

SERVER = Path(__file__).resolve().parent / "pg_server.mjs"

def conectar_pg(params: dict, tentativas: int = 5, **kwargs) -> psycopg.Connection:
    """Abre uma conexao com o PGlite, repetindo se o servidor ainda estiver encerrando a sessao anterior.

    O PGlite aceita uma conexao por vez; logo apos um close, uma nova pode ser recusada por instantes.
    """
    for i in range(tentativas):
        try:
            return psycopg.connect(**params, **kwargs)
        except psycopg.OperationalError as exc:
            if "closed the connection" not in str(exc) or i == tentativas - 1:
                raise
            time.sleep(0.2 * (i + 1))
    raise AssertionError("inalcancavel")


def conectar_target_pg(target_cfg, password: str):
    """Mesmo retry para connect_target (usado nos testes de gravacao)."""
    from brinde_gateway.target import connect_target

    for i in range(5):
        try:
            return connect_target(target_cfg, password)
        except psycopg.OperationalError as exc:
            if "closed the connection" not in str(exc) or i == 4:
                raise
            time.sleep(0.2 * (i + 1))
    raise AssertionError("inalcancavel")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def pg():
    """Servidor PGlite (Postgres em memoria) via socket; devolve os parametros de conexao."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node nao encontrado no PATH: testes de integracao com PGlite foram pulados")
    port = _free_port()
    # stdout so para o aviso "pronto"; stderr vai direto para o log do pytest/CI (erros do servidor).
    proc = subprocess.Popen(
        [node, str(SERVER), str(port)],
        stdout=subprocess.PIPE,
        stderr=None,
        text=True,
        cwd=str(SERVER.parent),
    )
    try:
        line = proc.stdout.readline().strip()
        if line != "pronto":
            rest = proc.stdout.read() if proc.poll() is not None else ""
            pytest.fail(f"servidor PGlite nao iniciou: {line} {rest}")
        yield {
            "host": "127.0.0.1",
            "port": port,
            "dbname": "postgres",
            "user": "postgres",
            "password": "x",
            "sslmode": "disable",
        }
    finally:
        # Se o servidor morreu durante os testes, registra o código de saída no log.
        codigo = proc.poll()
        if codigo is not None:
            print(f"\n[gateway tests] servidor PGlite encerrou antes do fim, codigo={codigo}", file=sys.stderr)
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        proc.stdout.close()


@pytest.fixture
def target_cfg(pg):
    from brinde_gateway.config import TargetConfig

    return TargetConfig(host=pg["host"], port=pg["port"], dbname=pg["dbname"], user=pg["user"], sslmode=pg["sslmode"])


@pytest.fixture
def clean_db(pg):
    """Limpa erp.cost_tiers e core.sync_runs (e fecha a conexao: PGlite aceita uma por vez)."""
    with conectar_pg(pg, prepare_threshold=None) as conn:
        conn.execute("truncate erp.cost_tiers restart identity")
        conn.execute("truncate core.sync_runs restart identity")
    yield


@pytest.fixture
def query(pg):
    """Executa uma consulta numa conexao curta (chamar so com a do teste fechada)."""

    def _q(sql_text, params=None):
        with conectar_pg(pg, prepare_threshold=None) as conn:
            return conn.execute(sql_text, params).fetchall()

    return _q


@pytest.fixture(autouse=True)
def _limpa_handlers_de_log():
    """Remove/fecha handlers do logger do gateway criados por cli._setup_logging."""
    yield
    import logging

    lg = logging.getLogger("brinde_gateway")
    for h in list(lg.handlers):
        lg.removeHandler(h)
        h.close()
