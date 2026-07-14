from kb.agents.structured import structured_output_kwargs


def test_ollama_models_use_native_format_param():
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = structured_output_kwargs("ollama_chat/qwen3:4b", schema, name="select_output")
    assert kwargs == {"extra_body": {"format": schema}}


def test_frontier_models_use_response_format_with_given_name():
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = structured_output_kwargs("gemini/gemini-2.5-flash", schema, name="select_output")
    assert kwargs == {
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "select_output",
                "strict": True,
                "schema": schema,
            },
        }
    }
