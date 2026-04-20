import yaml

_DELIM = "---"


def parse(text: str) -> tuple[dict, str]:
    lines = text.split("\n")
    if not lines or lines[0].strip() != _DELIM:
        raise ValueError("Missing opening '---' frontmatter delimiter")
    for i in range(1, len(lines)):
        if lines[i].strip() == _DELIM:
            yaml_block = "\n".join(lines[1:i])
            body = "\n".join(lines[i + 1 :])
            try:
                fm = yaml.safe_load(yaml_block) or {}
            except yaml.YAMLError as exc:
                raise ValueError(f"Invalid YAML frontmatter: {exc}") from exc
            if not isinstance(fm, dict):
                raise ValueError("Frontmatter must be a YAML mapping")
            return fm, body
    raise ValueError("Missing closing '---' frontmatter delimiter")


def dump(frontmatter: dict, body: str) -> str:
    yaml_block = yaml.safe_dump(
        frontmatter,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
    return f"{_DELIM}\n{yaml_block}{_DELIM}\n{body}"
