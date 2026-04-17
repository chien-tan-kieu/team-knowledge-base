import time
import pytest
from kb.auth.jwt import encode_session_jwt, decode_session_jwt, SessionTokenError


def test_roundtrip_valid_token():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=60)
    claims = decode_session_jwt(token, secret="s3cret")
    assert claims["sub"] == "spa"
    assert claims["exp"] > claims["iat"]


def test_expired_token_raises():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=-1)
    with pytest.raises(SessionTokenError):
        decode_session_jwt(token, secret="s3cret")


def test_wrong_secret_raises():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=60)
    with pytest.raises(SessionTokenError):
        decode_session_jwt(token, secret="other")


def test_garbage_raises():
    with pytest.raises(SessionTokenError):
        decode_session_jwt("not-a-jwt", secret="s3cret")
