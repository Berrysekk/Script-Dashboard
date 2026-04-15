import pytest
from backend.services.executor import parse_interval


def test_parse_seconds():
    assert parse_interval("30s") == 30


def test_parse_minutes():
    assert parse_interval("10m") == 600


def test_parse_hours():
    assert parse_interval("6h") == 21600


def test_parse_days():
    assert parse_interval("1d") == 86400


def test_parse_whitespace():
    assert parse_interval("  5m  ") == 300


def test_parse_invalid():
    with pytest.raises(ValueError, match="Invalid interval"):
        parse_interval("banana")


def test_parse_invalid_bare_number():
    with pytest.raises(ValueError, match="Invalid interval"):
        parse_interval("60")


def test_parse_invalid_zero():
    with pytest.raises(ValueError, match="Invalid interval"):
        parse_interval("0h")


def test_parse_invalid_negative():
    with pytest.raises(ValueError, match="Invalid interval"):
        parse_interval("-5m")


def test_parse_invalid_decimal():
    with pytest.raises(ValueError, match="Invalid interval"):
        parse_interval("1.5h")


def test_parse_rejects_tight_loop():
    # Intervals below the configured minimum should be rejected to prevent
    # DoS via a 1-second polling loop.
    with pytest.raises(ValueError, match="at least"):
        parse_interval("1s")
    with pytest.raises(ValueError, match="at least"):
        parse_interval("5s")
