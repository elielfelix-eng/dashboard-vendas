"""Execucao completa: le cada dataset do ERP e grava no Supabase."""

from __future__ import annotations

import logging
import urllib.request

import psycopg
from psycopg.types.json import Jsonb

from . import secrets as _secrets
from . import source as _source
from . import target as _target
from .config import Config
from .source import mask

log = logging.getLogger("brinde_gateway")


def default_ping(url: str) -> None:
    with urllib.request.urlopen(url, timeout=10):
        pass


def _safe_ping(ping, url: str | None, suffix: str = "") -> None:
    if not url:
        return
    try:
        ping(url.rstrip("/") + suffix if suffix else url)
    except Exception:
        log.warning("Nao foi possivel acionar o healthcheck (ignorado).")


def _describe(exc: BaseException, secrets_to_hide: list[str]) -> str:
    text = mask(f"{type(exc).__name__}: {exc}")
    for s in secrets_to_hide:
        if s:
            text = text.replace(s, "***")
    return " ".join(text.split())[:500]


def run(
    config: Config,
    *,
    source_connect=_source.connect_source,
    target_connect=_target.connect_target,
    get_secret=_secrets.get_secret,
    ping=default_ping,
) -> int:
    url = config.healthcheck_url
    _safe_ping(ping, url, "/start")

    password = ""
    try:
        password = get_secret("supabase")
        conn = target_connect(config.target, password)
    except (_secrets.SecretMissing, _secrets.SecretError, psycopg.Error, OSError) as exc:
        log.error("Nao foi possivel conectar no Supabase: %s", _describe(exc, [password]))
        _safe_ping(ping, url, "/fail")
        return 2

    try:
        with conn.cursor() as cur:
            cur.execute("insert into core.sync_runs (source, status) values ('erp', 'running') returning id")
            run_id = cur.fetchone()[0]
        conn.commit()
        log.info("Execucao %s iniciada (%d datasets).", run_id, len(config.datasets))

        stats: dict[str, int] = {}
        errors: list[str] = []
        src = None
        src_error = None
        try:
            src = source_connect(config.source)
        except Exception as exc:
            src_error = _describe(exc, [password])
            log.error("Nao foi possivel conectar no ERP: %s", src_error)

        try:
            for ds in config.datasets:
                if src is None:
                    stats[ds.name] = -1
                    errors.append(f"{ds.name}: sem conexao com o ERP ({src_error})")
                    continue
                try:
                    columns, rows = _source.fetch(ds, src)
                    n = _target.write_dataset(conn, ds, columns, rows)
                    stats[ds.name] = n
                    log.info("Dataset '%s': %d linhas gravadas em %s.", ds.name, n, ds.target_table)
                except Exception as exc:
                    stats[ds.name] = -1
                    msg = _describe(exc, [password])
                    errors.append(f"{ds.name}: {msg}")
                    log.error("Dataset '%s' falhou: %s", ds.name, msg)
                    try:
                        conn.rollback()
                    except psycopg.Error:
                        pass
        finally:
            if src is not None:
                try:
                    src.close()
                except Exception:
                    pass

        ok = not errors
        with conn.cursor() as cur:
            cur.execute(
                "update core.sync_runs set status = %s, finished_at = now(), stats = %s, error = %s "
                "where id = %s",
                ("success" if ok else "error", Jsonb(stats), None if ok else "; ".join(errors), run_id),
            )
        conn.commit()
    finally:
        conn.close()

    if ok:
        log.info("Execucao concluida com sucesso.")
        _safe_ping(ping, url)
        return 0
    log.error("Execucao concluida com erros.")
    _safe_ping(ping, url, "/fail")
    return 1
