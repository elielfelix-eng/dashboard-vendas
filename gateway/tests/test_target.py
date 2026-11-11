from datetime import datetime

import psycopg.errors
import pytest

from brinde_gateway.config import Dataset
from brinde_gateway.target import DatasetError, connect_target, write_dataset

COLS = ["product_id", "qty_start", "price", "created_at"]


def ds(mode="replace_source"):
    return Dataset(name="faixas", target_table="erp.cost_tiers", mode=mode, query="select 1")


@pytest.fixture
def conn(target_cfg, clean_db, pg):
    c = connect_target(target_cfg, pg["password"])
    yield c
    c.close()


def tiers(conn):
    return conn.execute("select product_id, source, price from erp.cost_tiers order by id").fetchall()


def test_replace_source_preserva_manual(conn):
    conn.execute(
        "insert into erp.cost_tiers (product_id, qty_start, price, created_at, source) "
        "values ('M1', 1, 9, '2026-01-01', 'manual')"
    )
    conn.commit()
    n = write_dataset(conn, ds(), COLS, [("A", 1, 1.5, datetime(2026, 1, 1)), ("B", 1, 2, datetime(2026, 1, 1))])
    assert n == 2
    assert [(r[0], r[1]) for r in tiers(conn)] == [("M1", "manual"), ("A", "erp"), ("B", "erp")]


def test_segunda_gravacao_substitui(conn):
    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 1, 1))])
    write_dataset(conn, ds(), COLS, [("B", 1, 1, datetime(2026, 1, 1))])
    assert [r[0] for r in tiers(conn)] == ["B"]


def test_replace_all_recusado_em_tabela_com_source(conn):
    with pytest.raises(DatasetError, match="replace_source"):
        write_dataset(conn, ds("replace_all"), COLS, [("A", 1, 1, datetime(2026, 1, 1))])


def test_replace_all_em_tabela_sem_source(conn):
    conn.execute("create table if not exists erp.estoque_teste (sku text, qtd int)")
    conn.execute("delete from erp.estoque_teste")
    conn.execute("insert into erp.estoque_teste values ('velho', 1)")
    conn.commit()
    d = Dataset(name="estoque", target_table="erp.estoque_teste", mode="replace_all", query="select 1")
    assert write_dataset(conn, d, ["sku", "qtd"], [("a", 1), ("b", 2)]) == 2
    assert conn.execute("select sku from erp.estoque_teste order by sku").fetchall() == [("a",), ("b",)]


def test_fuso_correto_mesmo_com_sessao_em_utc(conn):
    conn.execute("set time zone 'UTC'")
    conn.commit()
    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 10, 1, 0, 0))])
    conn.execute("set time zone 'UTC'")
    assert conn.execute("select to_char(created_at, 'YYYY-MM-DD HH24:MI') from erp.cost_tiers").fetchone()[0] == "2026-10-01 03:00"


def test_coluna_desconhecida(conn):
    with pytest.raises(DatasetError, match="coluna_x"):
        write_dataset(conn, ds(), COLS + ["coluna_x"], [("A", 1, 1, datetime(2026, 1, 1), 1)])


def test_source_na_consulta_em_replace_source(conn):
    with pytest.raises(DatasetError, match="source"):
        write_dataset(conn, ds(), COLS + ["source"], [("A", 1, 1, datetime(2026, 1, 1), "x")])


def test_erro_no_meio_faz_rollback(conn):
    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 1, 1))])
    with pytest.raises(psycopg.errors.NotNullViolation):
        write_dataset(conn, ds(), COLS, [("B", 1, 1, datetime(2026, 1, 1)), ("C", 1, None, datetime(2026, 1, 1))])
    assert [r[0] for r in tiers(conn)] == ["A"]


def test_datetime_sem_fuso_e_horario_de_brasilia(conn):
    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 10, 1, 0, 0))])
    with conn.cursor() as cur:
        cur.execute("set time zone 'UTC'")
        cur.execute("select to_char(created_at, 'YYYY-MM-DD HH24:MI') from erp.cost_tiers")
        assert cur.fetchone()[0] == "2026-10-01 03:00"


def test_zero_linhas_mantem_dados_anteriores(conn):
    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 1, 1))])
    with pytest.raises(DatasetError, match="0 linhas"):
        write_dataset(conn, ds(), COLS, [])
    assert [r[0] for r in tiers(conn)] == ["A"]


def test_zero_linhas_com_allow_empty_esvazia(conn):
    from dataclasses import replace

    write_dataset(conn, ds(), COLS, [("A", 1, 1, datetime(2026, 1, 1))])
    assert write_dataset(conn, replace(ds(), allow_empty=True), COLS, []) == 0
    assert tiers(conn) == []
