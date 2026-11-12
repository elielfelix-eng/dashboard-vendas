import sqlite3

import pytest

from brinde_gateway.config import Config, Dataset, SourceConfig
from brinde_gateway.runner import run
from brinde_gateway.secrets import SecretMissing
from brinde_gateway.target import connect_target

GOOD = "select product_id, qty_start, price, created_at from faixas"


def make_erp():
    c = sqlite3.connect(":memory:")
    c.execute("create table faixas (product_id text, qty_start int, price real, created_at text)")
    c.execute("insert into faixas values ('A', 1, 1.5, '2026-01-01 00:00')")
    c.execute("insert into faixas values ('B', 1, 2.5, '2026-01-01 00:00')")
    c.commit()
    return c


def make_config(target_cfg, queries, url=None):
    datasets = [
        Dataset(name=name, target_table="erp.cost_tiers", mode="replace_source", query=q)
        for name, q in queries.items()
    ]
    return Config(source=SourceConfig("x"), target=target_cfg, datasets=datasets, healthcheck_url=url)


def go(cfg, pings=None, **kw):
    pings = [] if pings is None else pings
    return run(
        cfg,
        source_connect=lambda _s: make_erp(),
        target_connect=connect_target,
        get_secret=lambda _n: "senha-teste",
        ping=pings.append,
        **kw,
    )


def test_tudo_valido(target_cfg, clean_db, query):
    pings = []
    cfg = make_config(target_cfg, {"faixas": GOOD}, url="http://hc/abc")
    assert go(cfg, pings) == 0
    assert pings == ["http://hc/abc/start", "http://hc/abc"]
    status, stats, err = query("select status, stats, error from core.sync_runs")[0]
    assert (status, stats, err) == ("success", {"faixas": 2}, None)
    assert query("select count(*) from erp.cost_tiers where source = 'erp'")[0][0] == 2


def test_dataset_com_erro_nao_impede_os_demais(target_cfg, clean_db, query):
    pings = []
    cfg = make_config(target_cfg, {"ruim": "select * from nao_existe", "faixas": GOOD}, url="http://hc/abc/")
    assert go(cfg, pings) == 1
    assert pings == ["http://hc/abc/start", "http://hc/abc/fail"]
    status, stats, err = query("select status, stats, error from core.sync_runs")[0]
    assert status == "error"
    assert stats == {"ruim": -1, "faixas": 2}
    assert err.startswith("ruim:")
    assert query("select count(*) from erp.cost_tiers")[0][0] == 2


def test_ping_que_falha_nao_derruba(target_cfg, clean_db):
    def boom(_url):
        raise OSError("sem rede")

    cfg = make_config(target_cfg, {"faixas": GOOD}, url="http://hc/abc")
    rc = run(
        cfg,
        source_connect=lambda _s: make_erp(),
        target_connect=connect_target,
        get_secret=lambda _n: "senha-teste",
        ping=boom,
    )
    assert rc == 0


def test_sem_conexao_no_destino(target_cfg):
    pings = []
    cfg = make_config(target_cfg, {"faixas": GOOD}, url="http://hc/abc")

    def falta(_n):
        raise SecretMissing("segredo ausente")

    rc = run(cfg, source_connect=lambda _s: make_erp(), get_secret=falta, ping=pings.append)
    assert rc == 2
    assert pings == ["http://hc/abc/start", "http://hc/abc/fail"]


def test_erp_inacessivel(target_cfg, clean_db, query):
    def falha(_s):
        raise RuntimeError("PWD=segredo123;falhou")

    cfg = make_config(target_cfg, {"faixas": GOOD})
    rc = run(cfg, source_connect=falha, target_connect=connect_target, get_secret=lambda _n: "senha-teste", ping=lambda _u: None)
    assert rc == 1
    status, stats, err = query("select status, stats, error from core.sync_runs")[0]
    assert status == "error" and stats == {"faixas": -1}
    assert "segredo123" not in err


def test_falha_no_registro_inicial(target_cfg, clean_db, pg):
    pings = []

    def alvo_sem_sync_runs(cfg, pw):
        c = connect_target(cfg, pw)
        c.execute("alter table core.sync_runs rename to sync_runs_off")
        c.commit()
        return c

    cfg = make_config(target_cfg, {"faixas": GOOD}, url="http://hc/abc")
    try:
        rc = run(cfg, source_connect=lambda _s: make_erp(), target_connect=alvo_sem_sync_runs,
                 get_secret=lambda _n: "senha-teste", ping=pings.append)
    finally:
        import psycopg

        with psycopg.connect(**pg, prepare_threshold=None) as c:
            c.execute("alter table core.sync_runs_off rename to sync_runs")
    assert rc == 2
    assert pings == ["http://hc/abc/start", "http://hc/abc/fail"]


def test_dataset_invalido_no_destino_e_depois_valido(target_cfg, clean_db, query):
    cfg = make_config(
        target_cfg,
        {"ruim": "select product_id, qty_start, price, created_at, product_id as coluna_x from faixas", "faixas": GOOD},
    )
    assert go(cfg) == 1
    status, stats, err = query("select status, stats, error from core.sync_runs")[0]
    assert (status, stats) == ("error", {"ruim": -1, "faixas": 2})
    assert "coluna_x" in err
    assert query("select count(*) from erp.cost_tiers")[0][0] == 2


def test_marca_execucoes_antigas_sem_finalizacao(target_cfg, clean_db, pg, query):
    import psycopg

    with psycopg.connect(**pg, prepare_threshold=None) as c:
        c.execute("insert into core.sync_runs (source, status, started_at) values "
                  "('erp', 'running', now() - interval '3 hours'), "
                  "('erp', 'running', now() - interval '30 minutes')")
    assert go(make_config(target_cfg, {"faixas": GOOD})) == 0
    rows = query("select status, error, finished_at is not null from core.sync_runs order by id")
    assert rows[0] == ("error", "execucao interrompida (sem finalizacao)", True)
    assert rows[1] == ("running", None, False)
    assert rows[2][0] == "success"
