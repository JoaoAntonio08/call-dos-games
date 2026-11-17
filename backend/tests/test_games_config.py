from app.routes.jogos import check_interval


def test_free_games_interval_defaults_and_rejects_invalid_input():
    assert check_interval(None) == 1800
    assert check_interval("") == 1800
    assert check_interval("not-a-number") == 1800


def test_free_games_interval_is_bounded():
    assert check_interval("1") == 300
    assert check_interval("1800") == 1800
    assert check_interval("999999") == 86400
