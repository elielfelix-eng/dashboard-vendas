"""Segredos: variavel de ambiente ou arquivo protegido por DPAPI (escopo de maquina)."""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

VALID_NAMES = ("sqlserver", "supabase")
CRYPTPROTECT_UI_FORBIDDEN = 0x1
CRYPTPROTECT_LOCAL_MACHINE = 0x4


class SecretMissing(Exception):
    """Segredo nao encontrado."""


class SecretError(Exception):
    """Erro ao ler/gravar segredos."""


def _check_name(name: str) -> None:
    if name not in VALID_NAMES:
        raise SecretError(f"Nome de segredo invalido: use um de {', '.join(VALID_NAMES)}.")


def home_dir() -> Path:
    override = os.environ.get("BRINDE_GATEWAY_HOME")
    if override:
        return Path(override)
    base = os.environ.get("PROGRAMDATA") or r"C:\ProgramData"
    return Path(base) / "BrindeGateway"


def secrets_path() -> Path:
    return home_dir() / "secrets.json"


def _is_windows() -> bool:
    return sys.platform == "win32"


def _require_windows() -> None:
    if not _is_windows():
        raise SecretError(
            "Segredos em arquivo (DPAPI) so funcionam no Windows; "
            "fora dele use a variavel de ambiente BRINDE_GATEWAY_<NOME>."
        )


def _dpapi(data: bytes, protect: bool) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    pblob = ctypes.POINTER(DATA_BLOB)
    crypt32.CryptProtectData.argtypes = [
        pblob, wintypes.LPCWSTR, pblob, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, pblob,
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [
        pblob, ctypes.c_void_p, pblob, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, pblob,
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if protect:
        ok = crypt32.CryptProtectData(
            ctypes.byref(blob_in), None, None, None, None,
            CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
    else:
        ok = crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None, None, None, None,
            CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
    if not ok:
        raise SecretError(f"Falha na protecao DPAPI do segredo (codigo {ctypes.get_last_error()}).")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(blob_out.pbData, ctypes.c_void_p))


def _load_store() -> dict:
    path = secrets_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except PermissionError:
        raise SecretError(
            f"Sem permissao para ler o arquivo de segredos ({path}); execute como administrador."
        ) from None
    except (OSError, ValueError):
        raise SecretError(f"Arquivo de segredos ilegivel ou corrompido: {path}") from None
    if not isinstance(data, dict):
        raise SecretError(f"Arquivo de segredos invalido: {path}")
    return data


def get_secret(name: str) -> str:
    _check_name(name)
    env = os.environ.get(f"BRINDE_GATEWAY_{name.upper()}")
    if env:
        return env
    if not _is_windows():
        # Fora do Windows nao existe arquivo de segredos: so a variavel de ambiente vale.
        raise SecretMissing(
            f"Segredo '{name}' nao configurado. Defina a variavel de ambiente "
            f"BRINDE_GATEWAY_{name.upper()} (arquivo de segredos so existe no Windows)."
        )
    encoded = _load_store().get(name)
    if not encoded:
        raise SecretMissing(
            f"Segredo '{name}' nao configurado. Execute: BrindeGateway.exe set-secret {name}"
        )
    try:
        return _dpapi(base64.b64decode(encoded), protect=False).decode("utf-8")
    except SecretError:
        raise
    except Exception:
        raise SecretError(f"Nao foi possivel decifrar o segredo '{name}'.") from None


def set_secret(name: str, value: str) -> None:
    _check_name(name)
    if not value:
        raise SecretError("O valor do segredo nao pode ser vazio.")
    _require_windows()
    store = _load_store()
    store[name] = base64.b64encode(_dpapi(value.encode("utf-8"), protect=True)).decode("ascii")
    path = secrets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2), encoding="utf-8")
