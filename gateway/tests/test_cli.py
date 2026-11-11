from brinde_gateway import cli


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
    cli._setup_logging(False)  # libera o arquivo de log
