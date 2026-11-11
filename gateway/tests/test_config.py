import pytest

from brinde_gateway.config import ConfigError, load_config

BASE = """
[source]
connection_string = "DSN=ERP;UID=gateway_leitura"

[target]
host = "aws-0-sa-east-1.pooler.supabase.com"
port = 6543
dbname = "postgres"
user = "gateway_writer.abc"

[healthcheck]
url = "https://hc-ping.com/x"

[[datasets]]
name = "faixas_custo"
target_table = "erp.cost_tiers"
mode = "replace_source"
query = "select 1 as product_id"
"""


def write(tmp_path, text):
    p = tmp_path / "gateway.toml"
    p.write_text(text, encoding="utf-8")
    return p


def test_valid_full(tmp_path):
    cfg = load_config(write(tmp_path, BASE))
    assert cfg.source.connection_string == "DSN=ERP;UID=gateway_leitura"
    assert cfg.target.port == 6543
    assert cfg.target.sslmode == "require"
    assert cfg.healthcheck_url == "https://hc-ping.com/x"
    assert len(cfg.datasets) == 1
    ds = cfg.datasets[0]
    assert (ds.name, ds.target_table, ds.mode) == ("faixas_custo", "erp.cost_tiers", "replace_source")
    assert ds.query == "select 1 as product_id"


def test_odbc_dsn(tmp_path):
    text = BASE.replace('connection_string = "DSN=ERP;UID=gateway_leitura"', 'odbc_dsn = "ERP"')
    assert load_config(write(tmp_path, text)).source.connection_string == "DSN=ERP"


def test_source_both_or_none(tmp_path):
    both = BASE.replace("[target]", 'odbc_dsn = "ERP"\n[target]', 1)
    with pytest.raises(ConfigError, match="nao ambos"):
        load_config(write(tmp_path, both))
    none = BASE.replace('connection_string = "DSN=ERP;UID=gateway_leitura"', "")
    with pytest.raises(ConfigError, match="connection_string"):
        load_config(write(tmp_path, none))


def test_missing_target_field(tmp_path):
    with pytest.raises(ConfigError, match="target.host"):
        load_config(write(tmp_path, BASE.replace('host = "aws-0-sa-east-1.pooler.supabase.com"', "")))


def test_missing_target_section(tmp_path):
    head, _, tail = BASE.partition("[target]")
    rest = tail.partition("[healthcheck]")[2]
    with pytest.raises(ConfigError, match=r"\[target\]"):
        load_config(write(tmp_path, head + "[healthcheck]" + rest))


def test_no_datasets(tmp_path):
    with pytest.raises(ConfigError, match="pelo menos um"):
        load_config(write(tmp_path, BASE.split("[[datasets]]")[0]))


@pytest.mark.parametrize("bad", ["Faixas", "a-b", "a b", ""])
def test_invalid_name(tmp_path, bad):
    with pytest.raises(ConfigError, match="name"):
        load_config(write(tmp_path, BASE.replace('name = "faixas_custo"', f'name = "{bad}"')))


def test_duplicate_name(tmp_path):
    ds = BASE[BASE.index("[[datasets]]"):]
    with pytest.raises(ConfigError, match="duplicado"):
        load_config(write(tmp_path, BASE + ds))


@pytest.mark.parametrize("bad", ["public.cost_tiers", "cost_tiers", "erp.Cost", "erp.a.b", "erp.x-y"])
def test_invalid_target_table(tmp_path, bad):
    with pytest.raises(ConfigError, match="target_table"):
        load_config(write(tmp_path, BASE.replace("erp.cost_tiers", bad)))


def test_invalid_mode(tmp_path):
    with pytest.raises(ConfigError, match="mode"):
        load_config(write(tmp_path, BASE.replace("replace_source", "append")))


def test_query_and_query_file_exclusive(tmp_path):
    both = BASE.replace('query = "select', 'query_file = "q.sql"\nquery = "select')
    (tmp_path / "q.sql").write_text("select 2", encoding="utf-8")
    with pytest.raises(ConfigError, match="exatamente um"):
        load_config(write(tmp_path, both))
    neither = BASE.replace('query = "select 1 as product_id"', "")
    with pytest.raises(ConfigError, match="exatamente um"):
        load_config(write(tmp_path, neither))


def test_query_file_relative_to_config(tmp_path):
    (tmp_path / "consultas").mkdir()
    (tmp_path / "consultas" / "faixas.sql").write_text("select 9 as x\n", encoding="utf-8")
    text = BASE.replace('query = "select 1 as product_id"', 'query_file = "consultas/faixas.sql"')
    cfg = load_config(write(tmp_path, text))
    assert cfg.datasets[0].query == "select 9 as x"


def test_query_file_missing(tmp_path):
    text = BASE.replace('query = "select 1 as product_id"', 'query_file = "nao_existe.sql"')
    with pytest.raises(ConfigError, match="nao encontrado"):
        load_config(write(tmp_path, text))


def test_config_file_missing(tmp_path):
    with pytest.raises(ConfigError, match="nao encontrado"):
        load_config(tmp_path / "x.toml")


def _com(base, source_extra="", dataset_extra=""):
    base = base.replace('UID=gateway_leitura"', 'UID=gateway_leitura"' + source_extra)
    return base.replace('mode = "replace_source"', 'mode = "replace_source"' + dataset_extra)


def test_defaults_allow_empty_e_timeout(tmp_path):
    cfg = load_config(write(tmp_path, BASE))
    assert cfg.datasets[0].allow_empty is False
    assert cfg.source.query_timeout_seconds == 600


def test_allow_empty_e_timeout_validos(tmp_path):
    text = _com(BASE, "\nquery_timeout_seconds = 90", "\nallow_empty = true")
    cfg = load_config(write(tmp_path, text))
    assert cfg.datasets[0].allow_empty is True
    assert cfg.source.query_timeout_seconds == 90


@pytest.mark.parametrize("bad", ["0", "-5", '"10"', "true", "1.5"])
def test_timeout_invalido(tmp_path, bad):
    text = _com(BASE, f"\nquery_timeout_seconds = {bad}")
    with pytest.raises(ConfigError, match="query_timeout_seconds"):
        load_config(write(tmp_path, text))


def test_allow_empty_invalido(tmp_path):
    text = _com(BASE, "", '\nallow_empty = "sim"')
    with pytest.raises(ConfigError, match="allow_empty"):
        load_config(write(tmp_path, text))
