"""Leitura do ERP (SQL Server via ODBC)."""

from __future__ import annotations

import re

import pyodbc

from .config import Dataset, SourceConfig
from .secrets import SecretMissing, get_secret

_PWD_RE = re.compile(r"(?i)(\b(?:pwd|password)\s*=)([^;]*)")
_HAS_AUTH_RE = re.compile(r"(?i)(\bpwd\s*=|\bpassword\s*=|\btrusted_connection\s*=\s*yes)")


def mask(conn_str: str) -> str:
    """Substitui o valor de PWD=/Password= por ***."""
    return _PWD_RE.sub(r"\1***", conn_str)


def build_connection_string(source_cfg: SourceConfig) -> str:
    conn_str = source_cfg.connection_string.strip()
    if _HAS_AUTH_RE.search(conn_str):
        return conn_str
    try:
        password = get_secret("sqlserver")
    except SecretMissing:
        return conn_str
    if not conn_str.endswith(";"):
        conn_str += ";"
    return f"{conn_str}PWD={password}"


def connect_source(source_cfg: SourceConfig):
    return pyodbc.connect(build_connection_string(source_cfg), readonly=True, timeout=30)


def fetch(dataset: Dataset, conn) -> tuple[list[str], list[tuple]]:
    cur = conn.cursor()
    try:
        cur.execute(dataset.query)
        columns = [d[0].lower() for d in cur.description]
        rows = [tuple(r) for r in cur.fetchall()]
    finally:
        cur.close()
    return columns, rows
