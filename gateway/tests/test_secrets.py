import sys

import pytest

from brinde_gateway.secrets import SecretError, SecretMissing, get_secret, set_secret


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setenv("BRINDE_GATEWAY_HOME", str(tmp_path))
    for n in ("SQLSERVER", "SUPABASE"):
        monkeypatch.delenv(f"BRINDE_GATEWAY_{n}", raising=False)


def test_env_has_priority(monkeypatch):
    monkeypatch.setenv("BRINDE_GATEWAY_SQLSERVER", "da-env")
    assert get_secret("sqlserver") == "da-env"


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI so no Windows")
def test_missing_message():
    with pytest.raises(SecretMissing, match="set-secret supabase") as exc:
        get_secret("supabase")
    assert "BrindeGateway.exe" in str(exc.value)


def test_invalid_name():
    with pytest.raises(SecretError):
        get_secret("outro")


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI so no Windows")
def test_roundtrip_and_not_plaintext(tmp_path):
    set_secret("sqlserver", "S3nh@-Secreta-çã")
    assert get_secret("sqlserver") == "S3nh@-Secreta-çã"
    raw = (tmp_path / "secrets.json").read_bytes()
    assert b"S3nh@-Secreta" not in raw
    set_secret("supabase", "outra")
    assert get_secret("sqlserver") == "S3nh@-Secreta-çã"
    assert get_secret("supabase") == "outra"


@pytest.mark.skipif(sys.platform == "win32", reason="so fora do Windows")
def test_file_secrets_error_off_windows():
    with pytest.raises(SecretError, match="Windows"):
        set_secret("sqlserver", "x")
