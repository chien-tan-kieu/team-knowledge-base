import json
import logging
from kb.logging import setup_logging, request_id_var


def test_json_formatter_emits_required_fields(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    logger.info("hello world", extra={"foo": "bar"})

    captured = capsys.readouterr().out.strip().splitlines()[-1]
    payload = json.loads(captured)
    assert payload["level"] == "INFO"
    assert payload["logger"] == "kb.test"
    assert payload["message"] == "hello world"
    assert "ts" in payload
    assert payload["foo"] == "bar"


def test_request_id_is_included_when_set(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    token = request_id_var.set("01HABC")
    try:
        logger.info("with id")
    finally:
        request_id_var.reset(token)

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["request_id"] == "01HABC"


def test_request_id_omitted_when_unset(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    logger.info("no id")

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert "request_id" not in payload
