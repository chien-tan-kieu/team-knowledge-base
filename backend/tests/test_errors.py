from kb.errors import ErrorCode, ErrorResponse


def test_error_codes_are_screaming_snake_case():
    expected = {
        "VALIDATION_ERROR",
        "UNAUTHENTICATED",
        "NOT_FOUND",
        "UPSTREAM_LLM_ERROR",
        "INTERNAL_ERROR",
    }
    assert {c.value for c in ErrorCode} == expected


def test_error_response_serialises_flat():
    resp = ErrorResponse(
        code=ErrorCode.NOT_FOUND,
        message="Job not found.",
        request_id="01HN6YV8XTR9A1TQ2M3X7E1B4C",
    )
    assert resp.model_dump() == {
        "code": "NOT_FOUND",
        "message": "Job not found.",
        "request_id": "01HN6YV8XTR9A1TQ2M3X7E1B4C",
    }
