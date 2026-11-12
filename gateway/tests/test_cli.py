from brinde_gateway import cli

CONFIG = """[source]
odbc_dsn = "x"
[target]
host = "h"
port = 5432
dbname = "d"
user = "u"
[[datasets]]
name = "a"
target_table = "erp.a"
mode = "replace_all"
query = "select 1"
"""


def test_set_secret_grava(monkeypatch, capsys):
    gravado = {}
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": "valor-secreto")
    monkeypatch.setattr(cli._secrets, "set_secret", lambda n, v: gravado.update({n: v}))
    assert cli.main(["set-secret", "supabase"]) == 0
    assert gravado == {"supabase": "valor-secreto"}
    out = capsys.readouterr()
    assert "valor-secreto" not in out.out + out.err


def test_set_secret_nome_invalido(monkeypatch, capsys):
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": "x")
    assert cli.main(["set-secret", "outro"]) == 2
    assert "invalido" in capsys.readouterr().err


def test_run_config_inexistente(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BRINDE_GATEWAY_HOME", str(tmp_path))
    rc = cli.main(["run", "--config", str(tmp_path / "nao_existe.toml")])
    assert rc != 0
    assert "nao encontrado" in capsys.readouterr().err


def test_erro_inesperado_vira_codigo_1(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("BRINDE_GATEWAY_HOME", str(tmp_path))
    cfg = tmp_path / "c.toml"
    cfg.write_text(CONFIG, encoding="utf-8")

    def boom(_config):
        raise RuntimeError("PWD=segredo123;x")

    monkeypatch.setattr(cli.runner, "run", boom)
    assert cli.main(["run", "--config", str(cfg)]) == 1
    err = capsys.readouterr().err
    assert "Erro inesperado" in err and "segredo123" not in err


def test_set_secret_interrompido(monkeypatch, capsys):
    def interrompe(prompt=""):
        raise KeyboardInterrupt

    monkeypatch.setattr(cli.getpass, "getpass", interrompe)
    assert cli.main(["set-secret", "supabase"]) == 1
    assert "cancelada" in capsys.readouterr().err

    def eof(prompt=""):
        raise EOFError

    monkeypatch.setattr(cli.getpass, "getpass", eof)
    assert cli.main(["set-secret", "supabase"]) == 1


def _prepara_test(monkeypatch, tmp_path):
    monkeypatch.setenv("BRINDE_GATEWAY_HOME", str(tmp_path))
    cfg = tmp_path / "c.toml"
    cfg.write_text(CONFIG, encoding="utf-8")
    monkeypatch.setattr(cli._secrets, "get_secret", lambda n: "senha-xyz")

    def sem_erp(_cfg):
        raise RuntimeError("sem erp")

    monkeypatch.setattr(cli._source, "connect_source", sem_erp)
    return cfg


def test_test_mostra_motivo_mascarado_do_supabase(monkeypatch, tmp_path, capsys):
    cfg = _prepara_test(monkeypatch, tmp_path)

    def falha(_t, _p):
        raise RuntimeError("password authentication failed senha-xyz PWD=abc;")

    monkeypatch.setattr(cli._target, "connect_target", falha)
    assert cli.main(["test", "--config", str(cfg)]) == 2
    out = capsys.readouterr().out
    assert "password authentication failed" in out
    assert "senha-xyz" not in out and "PWD=abc" not in out


def test_test_permissao_negada_sugere_administrador(monkeypatch, tmp_path, capsys):
    cfg = _prepara_test(monkeypatch, tmp_path)

    def nega(_t, _p):
        raise PermissionError(13, "Acesso negado")

    monkeypatch.setattr(cli._target, "connect_target", nega)
    cli.main(["test", "--config", str(cfg)])
    assert "administrador" in capsys.readouterr().out
