import os
import json
import time
from app.core.ai_client import chat_with_retry, clean_model_output
from app.core.scan_batching import run_batched_scan
from app.core.scope import resolve_scope
from app.core.relevance_filter import is_relevant_to_pillar
from app.core.file_chunker import chunk_file_content, adjust_finding_line


API_DESIGN_KEYWORDS = ["route", "router", "api", "controller", "endpoint", "views"]


SKIP_PATH_PATTERNS = ["vendor", "third_party", "third-party", "dist", "build", ".min.js", ".min.css", "jquery", "bootstrap"]


def find_relevant_files(repo_path: str, extensions=(".py", ".js", ".ts", ".mjs", ".cjs", ".go", ".java", ".rb", ".php", ".rs", ".cs", ".kt", ".swift", ".scala", ".dart", ".ex", ".exs", ".lua", ".pl")):
    relevant = []
    skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", "cloned_repos"}

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file in files:
            if not file.endswith(extensions):
                continue
            full_path = os.path.join(root, file)
            lower_path = full_path.lower()
            if any(pattern in lower_path for pattern in SKIP_PATH_PATTERNS):
                continue
            # Never scan "_fixed" scratch copies created by apply_fix_to_copy —
            # these are temporary artifacts, not real source files.
            if "_fixed" in os.path.splitext(os.path.basename(full_path))[0]:
                continue
            relevant.append(full_path)

    return relevant


def _scan_chunk(file_path: str, chunk_text: str, chunk_start_line: int) -> list:
    if not is_relevant_to_pillar(chunk_text, "api_design"):
        print(f"[relevance_filter] api_design: skipping a chunk of {file_path} (no relevant signals)")
        return []

    prompt = f"""You are an API design reviewer. Look at this file and identify API design issues ONLY (wrong HTTP methods, missing API versioning, inconsistent naming conventions, missing pagination, wrong HTTP status codes, sensitive fields exposed in responses, returning full DB objects instead of DTOs).

If there are no clear API design issues, return an empty array.

File: {file_path}
Code:
{chunk_text}

Also classify each issue's scope:
- "local": the issue AND its fix are both fully contained within the code shown above.
- "redirect": the issue affects this route, but the architectural fix belongs in a different single file, specifically the entry/mounting file (e.g. missing API versioning, which should be configured at the router mount point like app.use('/api/v1', router) in app.js/server.js).
- "codebase_wide": the issue requires editing multiple different files across the repository (e.g. inconsistent naming conventions used across many controllers).

Respond ONLY with a JSON array, no preamble, no markdown fences. Each item:
{{
  "title": "short issue name",
  "line": approximate_line_number_or_null,
  "severity": "high" | "medium" | "low",
  "description": "what is wrong and why it matters",
  "scope": "local" | "redirect" | "codebase_wide"
}}"""

    try:
        response = chat_with_retry(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1500,
            temperature=0.0
        )
        raw_text = response.choices[0].message.content
        items = json.loads(clean_model_output(raw_text))
    except json.JSONDecodeError:
        items = []
    except Exception as e:
        # One unreachable provider or unusable answer must never zero out
        # the whole pillar: skip this chunk, keep scanning the repository.
        print(f"[api_design] AI failed on {file_path} ({e}) — chunk skipped, continuing")
        return []

    findings = []
    for item in items:
        title = item.get("title") or ""
        description = item.get("description") or ""
        findings.append({
            "pillar": "api_design",
            "tool": "groq_ai",
            "title": title,
            "file": file_path,
            "line": adjust_finding_line(item.get("line"), chunk_start_line),
            "severity": item.get("severity", "medium"),
            "description": description,
            "scope": resolve_scope(
                item.get("scope", "local"),
                title,
                description,
                severity=item.get("severity", "medium"),
            ),
        })
    return findings


def _scan_single_file(file_path: str) -> list:
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        return []

    if not content.strip():
        return []

    if not is_relevant_to_pillar(content, "api_design"):
        print(f"[relevance_filter] api_design: skipping {file_path} (no relevant signals)")
        return []

    chunks = chunk_file_content(content)
    if len(chunks) > 1:
        print(f"[chunker] api_design: {file_path} split into {len(chunks)} chunks ({len(content)} chars)")
    all_findings = []
    for chunk in chunks:
        all_findings.extend(_scan_chunk(file_path, chunk["text"], chunk["start_line"]))
    return all_findings


def _scan_batch(file_paths: list) -> list:
    findings = []
    for i, file_path in enumerate(file_paths):
        if i > 0:
            time.sleep(3)  # pace calls to stay under per-minute token limits
        findings.extend(_scan_single_file(file_path))
    return findings


def run_api_design_scan(repo_path: str, files: list = None):
    if files is None:
        files = find_relevant_files(repo_path)
    return run_batched_scan(files, API_DESIGN_KEYWORDS, _scan_batch)