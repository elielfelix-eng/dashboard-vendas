import sqlite3

import pytest

from brinde_gateway import source
from brinde_gateway.config import Dataset, SourceConfig
from brinde_gateway.source import connect_source, fetch, mask


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setenv("BRINDE_GATEWAY_HOME", str(tmp_path))
    monkeypatch.delenv("BRINDE_GATEWAY_SQLSERVER", raising=False)


def test_fetch_lowercases_and_keeps_types():
    conn = sqlite3.connect(":memory:")
    conn.execute("create table t (Id integer, Nome text, Preco real)")
    conn.execute("insert into t values (1, 'a', 2.5), (2, null, 3.0)")
    ds = Dataset("x", "erp.x", "replace_all", "select Id as Product_ID, Nome, Preco from t order by Id")
    cols, rows = fetch(ds, conn)
    assert cols == ["product_id", "nome", "preco"]
    assert rows == [(1, "a", 2.5), (2, None, 3.0)]
    assert all(isinstance(r, tuple) for r in rows)


def test_mask():
    assert mask("DSN=ERP;PWD=abc;UID=u") == "DSN=ERP;PWD=***;UID=u"
    assert mask("DSN=ERP;Password=abc") == "DSN=ERP;Password=***"
    assert mask("dsn=ERP;pwd=abc;") == "dsn=ERP;pwd=***;"
    assert mask("DSN=ERP;UID=u") == "DSN=ERP;UID=u"


@pytest.fixture
def captured(monkeypatch):
    calls = []

    def fake(conn_str, **kw):
        calls.append((conn_str, kw))
        return object()

    monkeypatch.setattr(source.pyodbc, "connect", fake)
    return calls


def test_connect_dsn_without_secret(captured):
    connect_source(SourceConfig("DSN=ERP"))
    assert captured == [("DSN=ERP", {"readonly": True, "timeout": 30})]


def test_connect_appends_secret(captured, monkeypatch):
    monkeypatch.setenv("BRINDE_GATEWAY_SQLSERVER", "pw1")
    connect_source(SourceConfig("DSN=ERP;UID=u"))
    connect_source(SourceConfig("DSN=ERP;UID=u;"))
    assert captured[0][0] == "DSN=ERP;UID=u;PWD={pw1}"
    assert captured[1][0] == "DSN=ERP;UID=u;PWD={pw1}"


@pytest.mark.parametrize("cs", ["DSN=ERP;UID=u;PWD=x", "DSN=ERP;Password=x", "DSN=ERP;Trusted_Connection=yes", "DSN=ERP;Trusted_Connection=true"])
def test_connect_does_not_duplicate_auth(captured, monkeypatch, cs):
    monkeypatch.setenv("BRINDE_GATEWAY_SQLSERVER", "pw1")
    connect_source(SourceConfig(cs))
    assert captured[0][0] == cs


def test_connect_quotes_password_with_special_chars(captured, monkeypatch):
    monkeypatch.setenv("BRINDE_GATEWAY_SQLSERVER", "a;b}c")
    connect_source(SourceConfig("DSN=ERP;UID=u"))
    assert captured[0][0] == "DSN=ERP;UID=u;PWD={a;b}}c}"


def test_mask_brace_quoted():
    assert mask("DSN=ERP;PWD={a;b}}c};UID=u") == "DSN=ERP;PWD=***;UID=u"
    assert mask("DSN=ERP;Password={a;b}}c}") == "DSN=ERP;Password=***"
    assert "b" not in mask("PWD={a;b}}c}").replace("PWD", "")


def test_connect_off_windows_without_secret(captured, monkeypatch):
    from brinde_gateway import secrets as sec

    monkeypatch.setattr(sec, "_is_windows", lambda: False)
    with pytest.raises(sec.SecretMissing):
        sec.get_secret("sqlserver")
    connect_source(SourceConfig("DSN=ERP"))
    assert captured[0][0] == "DSN=ERP"
