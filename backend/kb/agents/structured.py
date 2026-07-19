OLLAMA_MODEL_PREFIXES = ("ollama/", "ollama_chat/")


def structured_output_kwargs(model: str, schema: dict, name: str) -> dict:
    """Provider-appropriate kwargs for JSON-Schema-constrained output.

    Ollama (via LiteLLM) doesn't reliably honor `response_format=json_schema`;
    instead, pass the schema through Ollama's native `format` parameter
    (extra_body), which reaches llama.cpp's grammar-constrained decoder.
    Frontier providers (OpenAI, Anthropic, Gemini) use the standard
    OpenAI-style `response_format`.
    """
    if model.startswith(OLLAMA_MODEL_PREFIXES):
        return {"extra_body": {"format": schema}}
    return {
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": name,
                "strict": True,
                "schema": schema,
            },
        }
    }
