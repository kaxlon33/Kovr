import shutil
import os
import re
import difflib


def _fuzzy_replace(content: str, before: str, after: str):
    """
    Line-level fallback for imperfect before_code. Smaller models sometimes
    paraphrase the original function (reorder lines, drop a blank line,
    tweak punctuation) even when the intent is identical. Compare
    line-by-line with difflib, find the longest run of matching lines, and
    replace that region of the REAL file with the fix when enough of the
    original block is found. Returns the new content, or None when the
    similarity is too low to patch safely.
    """
    orig_lines = content.splitlines()
    # Map each non-blank, stripped file line back to its real index.
    file_tokens = [(i, l.strip()) for i, l in enumerate(orig_lines) if l.strip()]
    before_tokens = [l.strip() for l in before.splitlines() if l.strip()]

    if len(before_tokens) < 2 or not file_tokens:
        return None

    matcher = difflib.SequenceMatcher(
        None, before_tokens, [t for _, t in file_tokens], autojunk=False
    )
    blocks = [b for b in matcher.get_matching_blocks() if b.size > 0]

    if not blocks:
        return None

    matched = sum(b.size for b in blocks)
    coverage = matched / len(before_tokens)

    # Require most of the reported function to be found overall, with at
    # least one run of 2+ consecutive matching lines, so we never patch an
    # unrelated lookalike region.
    if coverage < 0.6 or max(b.size for b in blocks) < 2:
        return None

    # Replace the file region from the first to the last matched line.
    start_token = min(b.b for b in blocks)
    end_token = max(b.b + b.size for b in blocks)

    start_line = file_tokens[start_token][0]
    end_line = file_tokens[end_token - 1][0] + 1

    replaced = orig_lines[:start_line] + [after] + orig_lines[end_line:]
    new_content = "\n".join(replaced)
    if content.endswith("\n"):
        new_content += "\n"
    return new_content


def apply_fix_to_copy(file_path: str, before_code: str, after_code: str):
    if not os.path.exists(file_path):
        return None, "Original file not found"

    name, ext = os.path.splitext(file_path)
    fixed_path = f"{name}_fixed{ext}"

    shutil.copy(file_path, fixed_path)

    with open(fixed_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    before = (before_code or "").strip()
    after = (after_code or "").strip()

    # 0. The fix may already be in the file — applied manually or by an
    #    earlier run. Ship the copy as-is so verify can confirm it.
    if after and after in content:
        return fixed_path, None

    # 1. Try an exact match first — fastest and most precise when the AI's
    #    before_code reproduces the file's formatting exactly.
    if before in content:
        new_content = content.replace(before, after)
        with open(fixed_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        return fixed_path, None

    # 2. Fall back to whitespace-tolerant matching. The AI sometimes
    #    reformats code (collapsing it to one line, changing indentation)
    #    while preserving the actual tokens. Build a regex that treats any
    #    run of whitespace in before_code as "one or more whitespace
    #    characters", so it matches regardless of exact line breaks/spacing,
    #    then replace the REAL matched text from the file (not the AI's
    #    possibly-reformatted version) with the fix.
    pattern_source = re.escape(before)
    pattern_source = re.sub(r"(\\\s)+", r"\\s+", pattern_source)
    # re.escape turns each whitespace char into an escaped literal; collapse
    # any run of escaped-whitespace tokens into a single \s+ token instead.
    pattern_source = re.sub(r"(?:\\ |\\\n|\\\t|\\\r)+", r"\\s+", pattern_source)

    try:
        match = re.search(pattern_source, content, re.DOTALL)
    except re.error:
        match = None

    if not match:
        # 3. Fuzzy line-level fallback for imperfect before_code.
        fuzzy = _fuzzy_replace(content, before, after)
        if fuzzy is not None:
            with open(fixed_path, "w", encoding="utf-8") as f:
                f.write(fuzzy)
            return fixed_path, None

        return None, (
            "before_code does not match file content exactly — the file may have "
            "been changed since the investigation (e.g. fixed manually). "
            "Re-investigate the finding to refresh the patch."
        )

    new_content = content[:match.start()] + after_code.strip() + content[match.end():]
    with open(fixed_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    return fixed_path, None