"""Escrita no Supabase (Postgres, schema erp)."""

from __future__ import annotations

import psycopg
from psycopg import sql

from .config import Dataset, TargetConfig

SOURCE_VALUE = "erp"
BATCH_SIZE = 1000


class DatasetError(Exception):
    """Dataset incompativel com a tabela de destino."""


def connect_target(target_cfg: TargetConfig, password: str) -> psycopg.Connection:
    conn = psycopg.connect(
        host=target_cfg.host,
        port=target_cfg.port,
        dbname=target_cfg.dbname,
        user=target_cfg.user,
        password=password,
        sslmode=target_cfg.sslmode,
        application_name="brinde-gateway",
        connect_timeout=30,
        autocommit=False,
        prepare_threshold=None,  # sem prepared statements: seguro com pooler e com o PGlite dos testes
    )
    try:
        conn.execute("SET TIME ZONE 'America/Sao_Paulo'")
        conn.commit()
    except Exception:
        conn.close()
        raise
    return conn


def set_local_timezone(conn: psycopg.Connection) -> None:
    """Fuso valido so na transacao atual (sobrevive ao pooler em modo transacao)."""
    conn.execute("select set_config('TimeZone', 'America/Sao_Paulo', true)")


def _table_columns(conn: psycopg.Connection, schema: str, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "select column_name from information_schema.columns "
            "where table_schema = %s and table_name = %s",
            (schema, table),
        )
        return {r[0] for r in cur.fetchall()}


def write_dataset(conn: psycopg.Connection, dataset: Dataset, columns: list[str], rows: list[tuple]) -> int:
    schema, table = dataset.target_table.split(".", 1)
    try:
        set_local_timezone(conn)
        existing = _table_columns(conn, schema, table)
        if not existing:
            raise DatasetError(f"Tabela de destino '{dataset.target_table}' nao existe.")
        unknown = [c for c in columns if c not in existing]
        if unknown:
            raise DatasetError(
                f"Dataset '{dataset.name}': colunas da consulta inexistentes em "
                f"{dataset.target_table}: {', '.join(unknown)}."
            )
        inject_source = dataset.mode == "replace_source"
        if not inject_source and "source" in existing:
            raise DatasetError(
                f"Dataset '{dataset.name}': {dataset.target_table} tem coluna 'source'; "
                "replace_all apagaria linhas de outras origens. Use mode = 'replace_source'."
            )
        if inject_source:
            if "source" in columns:
                raise DatasetError(
                    f"Dataset '{dataset.name}': a coluna 'source' nao pode vir da consulta "
                    "(ela e definida pelo gateway)."
                )
            if "source" not in existing:
                raise DatasetError(
                    f"Dataset '{dataset.name}': {dataset.target_table} nao tem a coluna 'source' "
                    "exigida por replace_source."
                )

        ident = sql.Identifier(schema, table)
        out_cols = list(columns) + (["source"] if inject_source else [])
        with conn.cursor() as cur:
            if inject_source:
                cur.execute(sql.SQL("delete from {} where source = %s").format(ident), (SOURCE_VALUE,))
            else:
                cur.execute(sql.SQL("delete from {}").format(ident))
            insert_stmt = sql.SQL("insert into {} ({}) values ({})").format(
                ident,
                sql.SQL(", ").join(sql.Identifier(c) for c in out_cols),
                sql.SQL(", ").join(sql.Placeholder() for _ in out_cols),
            )
            extra = (SOURCE_VALUE,) if inject_source else ()
            for i in range(0, len(rows), BATCH_SIZE):
                cur.executemany(insert_stmt, [tuple(r) + extra for r in rows[i : i + BATCH_SIZE]])
        conn.commit()
        return len(rows)
    except BaseException:
        conn.rollback()
        raise
