"""Linha de comando: run, test, set-secret."""

from __future__ import annotations

import argparse
import getpass
import logging
import logging.handlers
import sys
from pathlib import Path

from . import runner
from . import secrets as _secrets
from . import source as _source
from . import target as _target
from .config import ConfigError, load_config

log = logging.getLogger("brinde_gateway")


def _default_config() -> Path:
    return _secrets.home_dir() / "config.toml"


def _setup_logging(to_file: bool) -> None:
    root = logging.getLogger("brinde_gateway")
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
        h.close()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(fmt)
    root.addHandler(console)
    if to_file:
        try:
            logdir = _secrets.home_dir() / "logs"
            logdir.mkdir(parents=True, exist_ok=True)
            fh = logging.handlers.TimedRotatingFileHandler(
                logdir / "gateway.log", when="midnight", backupCount=30, encoding="utf-8"
            )
            fh.setFormatter(fmt)
            root.addHandler(fh)
        except OSError:
            log.warning("Nao foi possivel gravar o arquivo de log; seguindo so no console.")


def _cmd_run(args) -> int:
    _setup_logging(True)
    try:
        config = load_config(args.config)
    except ConfigError as exc:
        log.error("Configuracao invalida: %s", exc)
        return 2
    return runner.run(config)


def _cmd_test(args) -> int:
    _setup_logging(False)
    try:
        config = load_config(args.config)
    except ConfigError as exc:
        log.error("Configuracao invalida: %s", exc)
        return 2
    code = 0
    try:
        conn = _target.connect_target(config.target, _secrets.get_secret("supabase"))
        conn.close()
        print("Supabase: conexao OK")
    except (_secrets.SecretMissing, _secrets.SecretError) as exc:
        print(f"Supabase: falha - {exc}")
        code = 2
    except Exception as exc:
        print(f"Supabase: falha - {type(exc).__name__}")
        code = 2
    try:
        src = _source.connect_source(config.source)
    except Exception as exc:
        print(f"ERP: falha - {_source.mask(str(exc))}")
        return 2
    print("ERP: conexao OK")
    try:
        for ds in config.datasets:
            try:
                cols, rows = _source.fetch(ds, src)
                print(f"  {ds.name}: {len(rows)} linhas; colunas: {', '.join(cols)}")
            except Exception as exc:
                print(f"  {ds.name}: falha - {_source.mask(str(exc))}")
                code = code or 1
    finally:
        src.close()
    return code


def _cmd_set_secret(args) -> int:
    _setup_logging(False)
    try:
        value = getpass.getpass(f"Valor do segredo '{args.name}': ")
        _secrets.set_secret(args.name, value)
    except _secrets.SecretError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 2
    print(f"Segredo '{args.name}' gravado.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="brinde_gateway", description="Gateway ERP -> Supabase")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, func, help_ in (
        ("run", _cmd_run, "le o ERP e grava no Supabase"),
        ("test", _cmd_test, "testa as conexoes e as consultas (nao grava)"),
    ):
        p = sub.add_parser(name, help=help_)
        p.add_argument("--config", type=Path, default=None, help="caminho do config.toml")
        p.set_defaults(func=func)
    p = sub.add_parser("set-secret", help="grava um segredo (sqlserver ou supabase)")
    p.add_argument("name")
    p.set_defaults(func=_cmd_set_secret)
    args = parser.parse_args(argv)
    if args.command != "set-secret" and args.config is None:
        args.config = _default_config()
    try:
        return args.func(args)
    except Exception as exc:
        # Ultima barreira: registra (mascarado, sem segredos) no log e sai com codigo 1.
        log.error("Erro inesperado: %s", _source.mask(f"{type(exc).__name__}: {exc}"))
        return 1
