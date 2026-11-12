"""Leitura e validacao do arquivo de configuracao (TOML)."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9_]+$")
TABLE_RE = re.compile(r"^erp\.[a-z0-9_]+$")
MODES = ("replace_source", "replace_all")


class ConfigError(Exception):
    """Configuracao invalida."""


@dataclass(frozen=True)
class SourceConfig:
    connection_string: str
    query_timeout_seconds: int = 600


@dataclass(frozen=True)
class TargetConfig:
    host: str
    port: int
    dbname: str
    user: str
    sslmode: str = "require"


@dataclass(frozen=True)
class Dataset:
    name: str
    target_table: str
    mode: str
    query: str
    allow_empty: bool = False


@dataclass(frozen=True)
class Config:
    source: SourceConfig
    target: TargetConfig
    datasets: list[Dataset] = field(default_factory=list)
    healthcheck_url: str | None = None


def _section(data: dict, key: str) -> dict:
    value = data.get(key)
    if not isinstance(value, dict):
        raise ConfigError(f"Secao [{key}] obrigatoria ausente ou invalida.")
    return value


def _required_str(section: dict, key: str, where: str) -> str:
    value = section.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"Campo '{where}.{key}' obrigatorio (texto nao vazio).")
    return value.strip()


def _parse_source(data: dict) -> SourceConfig:
    s = _section(data, "source")
    has_cs = "connection_string" in s
    has_dsn = "odbc_dsn" in s
    if has_cs and has_dsn:
        raise ConfigError("Em [source] informe 'connection_string' ou 'odbc_dsn', nao ambos.")
    if not has_cs and not has_dsn:
        raise ConfigError("Em [source] informe 'connection_string' ou 'odbc_dsn'.")
    timeout = s.get("query_timeout_seconds", 600)
    if isinstance(timeout, bool) or not isinstance(timeout, int) or timeout <= 0:
        raise ConfigError("Campo 'source.query_timeout_seconds' invalido (inteiro maior que 0).")
    if has_cs:
        return SourceConfig(_required_str(s, "connection_string", "source"), timeout)
    return SourceConfig("DSN=" + _required_str(s, "odbc_dsn", "source"), timeout)


def _parse_target(data: dict) -> TargetConfig:
    t = _section(data, "target")
    port = t.get("port")
    if isinstance(port, bool) or not isinstance(port, int) or not 0 < port < 65536:
        raise ConfigError("Campo 'target.port' obrigatorio (inteiro entre 1 e 65535).")
    sslmode = t.get("sslmode", "require")
    if not isinstance(sslmode, str) or not sslmode:
        raise ConfigError("Campo 'target.sslmode' invalido.")
    return TargetConfig(
        host=_required_str(t, "host", "target"),
        port=port,
        dbname=_required_str(t, "dbname", "target"),
        user=_required_str(t, "user", "target"),
        sslmode=sslmode,
    )


def _parse_dataset(raw: object, index: int, base_dir: Path) -> Dataset:
    where = f"datasets[{index}]"
    if not isinstance(raw, dict):
        raise ConfigError(f"Item {where} invalido.")
    name = _required_str(raw, "name", where)
    if not NAME_RE.match(name):
        raise ConfigError(f"Campo '{where}.name' invalido ('{name}'): use apenas [a-z0-9_].")
    where = f"dataset '{name}'"
    table = _required_str(raw, "target_table", where)
    if not TABLE_RE.match(table):
        raise ConfigError(
            f"Campo 'target_table' do {where} invalido ('{table}'): use 'erp.<nome>' com [a-z0-9_]."
        )
    mode = _required_str(raw, "mode", where)
    if mode not in MODES:
        raise ConfigError(
            f"Campo 'mode' do {where} invalido ('{mode}'): use 'replace_source' ou 'replace_all'."
        )
    has_q, has_f = "query" in raw, "query_file" in raw
    if has_q == has_f:
        raise ConfigError(f"No {where} informe exatamente um entre 'query' e 'query_file'.")
    if has_q:
        query = _required_str(raw, "query", where)
    else:
        rel = _required_str(raw, "query_file", where)
        path = Path(rel)
        if not path.is_absolute():
            path = base_dir / path
        if not path.is_file():
            raise ConfigError(f"Arquivo 'query_file' do {where} nao encontrado: {path}")
        query = path.read_text(encoding="utf-8").strip()
        if not query:
            raise ConfigError(f"Arquivo 'query_file' do {where} esta vazio: {path}")
    allow_empty = raw.get("allow_empty", False)
    if not isinstance(allow_empty, bool):
        raise ConfigError(f"Campo 'allow_empty' do {where} invalido (use true ou false).")
    return Dataset(name=name, target_table=table, mode=mode, query=query, allow_empty=allow_empty)


def load_config(path: str | Path) -> Config:
    path = Path(path)
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        raise ConfigError(f"Arquivo de configuracao nao encontrado: {path}") from None
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Arquivo de configuracao com TOML invalido: {exc}") from None

    source = _parse_source(data)
    target = _parse_target(data)

    hc = data.get("healthcheck")
    healthcheck_url = None
    if hc is not None:
        if not isinstance(hc, dict):
            raise ConfigError("Secao [healthcheck] invalida.")
        healthcheck_url = _required_str(hc, "url", "healthcheck")

    raw_datasets = data.get("datasets")
    if not isinstance(raw_datasets, list) or not raw_datasets:
        raise ConfigError("Informe pelo menos um [[datasets]].")
    datasets: list[Dataset] = []
    seen: set[str] = set()
    for i, raw in enumerate(raw_datasets):
        ds = _parse_dataset(raw, i, path.resolve().parent)
        if ds.name in seen:
            raise ConfigError(f"Nome de dataset duplicado: '{ds.name}'.")
        seen.add(ds.name)
        datasets.append(ds)
    return Config(source=source, target=target, datasets=datasets, healthcheck_url=healthcheck_url)
