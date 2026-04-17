import time
import jwt as _pyjwt


class SessionTokenError(Exception):
    """Invalid, missing, or expired session token."""


def encode_session_jwt(secret: str, ttl_seconds: int) -> str:
    now = int(time.time())
    claims = {"sub": "spa", "iat": now, "exp": now + ttl_seconds}
    return _pyjwt.encode(claims, secret, algorithm="HS256")


def decode_session_jwt(token: str, secret: str) -> dict:
    try:
        return _pyjwt.decode(token, secret, algorithms=["HS256"])
    except _pyjwt.PyJWTError as exc:
        raise SessionTokenError(str(exc)) from exc
