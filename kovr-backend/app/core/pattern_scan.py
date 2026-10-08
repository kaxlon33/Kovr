"""
Step 2 of the codebase-wide handling plan: given a finding already
confirmed as scope="codebase_wide", search the rest of the repo for
other files likely to have the same issue. This does NOT generate fixes
(that's Step 3) — it only returns a list of candidate file paths.

To keep AI calls bounded, this uses a two-stage filter:
  1. Reuse the same file-listing function the original pillar scan used
     (so we search the same kind of files, not the whole repo).
  2. Ask the AI a single lightweight yes/no question per candidate file,
     rather than a full re-scan, to keep cost low.
"""
import json
import os
from app.core.ai_client import chat_with_retry, clean_model_output

MAX_FILES_TO_CHECK = 15  # cap AI calls per codebase-wide finding


def _get_candidate_files(pillar: str, repo_path: str, exclude_file: str) -> list:
    if pillar == "ui_ux":
        from app.scanner.ui_ux import find_frontend_files
        files = find_frontend_files(repo_path)
    else:
        from app.scanner.api_design import find_relevant_files
        files = find_relevant_files(repo_path)

    # Exclude the source file itself, and any "_fixed" backup copies that
    # apply_fix_to_copy leaves on disk — these are scratch artifacts, not
    # real source files, and must never be treated as a location to fix.
    files = [
        f for f in files
        if f != exclude_file and "_fixed" not in os.path.basename(f)
    ]
    return files[:MAX_FILES_TO_CHECK]


def _file_likely_affected(file_path: str, finding_title: str, finding_description: str) -> bool:
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        return False

    if not content.strip():
        return False

    prompt = f"""A code issue was found in another file of this project:
Title: {finding_title}
Description: {finding_description}

Does the SAME issue also appear in this file? Only answer yes if you can point to a concrete instance of this specific issue in the code below — not just because the file is related.

File: {file_path}
Code:
{content[:5000]}

Respond ONLY with JSON, no preamble, no markdown fences:
{{"affected": true or false}}"""

    try:
        response = chat_with_retry(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0.1
        )
        raw = response.choices[0].message.content
        result = json.loads(clean_model_output(raw))
        return bool(result.get("affected"))
    except Exception:
        return False


def find_pattern_locations(finding_pillar: str, finding_title: str, finding_description: str,
                            repo_path: str, exclude_file: str) -> list:
    """
    Returns a list of file paths (besides exclude_file) that likely have
    the same issue described by finding_title/finding_description.
    """
    candidates = _get_candidate_files(finding_pillar, repo_path, exclude_file)
    affected = []
    for file_path in candidates:
        if _file_likely_affected(file_path, finding_title, finding_description):
            affected.append(file_path)
    return affected

def generate_fix_for_location(file_path: str, finding_title: str, finding_description: str,
                                finding_line: int = None) -> dict:
    """
    Generates a concrete before_code/after_code fix for ONE file, given
    the shared issue title/description from the original codebase_wide
    finding. Reuses the same investigate_finding function used for normal
    local findings — same retry/fallback/no-op-rejection behavior.

    Uses the WHOLE file as context (capped) rather than a narrow window
    around a line, since these findings often don't have a specific line
    number, and the actual fix location (e.g. a route-mounting line) can
    be anywhere in the file, not necessarily near the top.
    """
    from app.core.ai_client import investigate_finding
    from app.core.cross_file_context import get_enhanced_context

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            code_snippet = f.read()[:6000]
    except Exception:
        code_snippet = ""

    effective_line = finding_line or 1
    code_snippet = get_enhanced_context(file_path, effective_line, code_snippet)

    finding_dict = {
        "tool": "groq_ai",
        "title": finding_title,
        "file": file_path,
        "line": finding_line,
        "description": finding_description,
    }

    result = investigate_finding(finding_dict, code_snippet=code_snippet)
    return result


def find_mounting_entry_file(repo_path: str, route_filename: str = "") -> str:
    """
    Finds the main entry file where routes are mounted with app.use() or include_router().
    Looks first for files mentioning the route file name or common entry points.
    """
    if not repo_path or not os.path.exists(repo_path):
        return None

    common_entry_names = ["app.js", "server.js", "index.js", "main.js", "app.ts", "server.ts", "index.ts", "main.py", "app.py"]
    skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", "cloned_repos"}

    candidates = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            full = os.path.join(root, f)
            if "_fixed" in f:
                continue
            if f.lower() in common_entry_names:
                candidates.append(full)

    # If route_filename provided (e.g. 'users.js' or 'auth.js'), prefer candidate that imports/requires it
    route_stem = os.path.splitext(route_filename)[0] if route_filename else ""
    if route_stem and candidates:
        for c in candidates:
            try:
                with open(c, "r", encoding="utf-8", errors="replace") as cf:
                    content = cf.read()
                    if route_stem in content and ("app.use" in content or "router" in content or "include_router" in content):
                        return c
            except Exception:
                continue

    return candidates[0] if candidates else None