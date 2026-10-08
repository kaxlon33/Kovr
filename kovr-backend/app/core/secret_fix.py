def generate_secret_redaction_fix(file_path: str, line_number: int):
    """
    Deterministically generate a before/after fix for a leaked-secret finding.
    Unlike code-logic fixes, this does not rely on the AI to propose a
    replacement — secret removal is a mechanical, well-defined action
    (delete the value, leave a clear marker), so it is generated directly
    for reliability and consistency.
    """
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return None, None

    if line_number < 1 or line_number > len(lines):
        return None, None

    original_line = lines[line_number - 1]
    indent = original_line[:len(original_line) - len(original_line.lstrip())]

    before_code = original_line.rstrip("\n")
    after_code = f"{indent}# [REDACTED] Secret removed by KOVR — rotate this credential and store it in a secret manager or environment variable."

    return before_code, after_code