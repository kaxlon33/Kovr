import json
from app.core.ai_client import chat_with_retry, clean_model_output
from app.core.scan_batching import run_batched_scan
from app.scanner.api_design import find_relevant_files
from app.core.scope import resolve_scope
from app.core.relevance_filter import is_relevant_to_pillar
from app.core.file_chunker import chunk_file_content, adjust_finding_line
import time

BACKEND_LOGIC_KEYWORDS = ["service", "controller", "model", "repository", "handler", "logic"]


def _scan_chunk(file_path: str, chunk_text: str, chunk_start_line: int) -> list:
    if not is_relevant_to_pillar(chunk_text, "backend_logic"):
        print(f"[relevance_filter] backend_logic: skipping a chunk of {file_path} (no relevant signals)")
        return []

    prompt = f"""You are a backend code reviewer. Look at this file and identify backend logic issues ONLY (empty catch blocks that swallow errors, returning HTTP 200 for errors instead of proper status codes, business logic in the wrong layer, N+1 database query problems, missing null/undefined checks, no logging for critical operations, raw exception messages returned to the client, missing database transaction handling for multi-step operations).

If there are no clear backend logic issues, return an empty array.

File: {file_path}
Code:
{chunk_text}

Also classify each issue's scope:
- "local": the issue AND its fix are both fully contained within the code shown above — even if the issue relates to a general coding convention or consistency pattern, if you can write a concrete fix using ONLY the code shown in this file, it is "local". This includes issues that AFFECT many routes/endpoints but can be FIXED with a single change in this file — for example, missing API versioning is usually fixable by changing ONE route-mounting line (e.g. app.use('/api', router) to app.use('/api/v1', router)), even though it affects every route "under" it. If the fix is a single edit in the file shown, it is "local", regardless of how many routes/endpoints are affected by that one change.
- "codebase_wide": ONLY use this if fixing the issue genuinely requires editing a DIFFERENT file than the one shown above (e.g. a shared config file, another module, or a pattern defined elsewhere that this file must match). Do not use "codebase_wide" just because the issue affects many routes/endpoints/functions — check whether the FIX itself is one edit or many edits. Only use "codebase_wide" when you cannot write a single fix without seeing or editing another file.

Respond ONLY with a JSON array, no preamble, no markdown fences. Each item:
{{
  "title": "short issue name",
  "line": approximate_line_number_or_null,
  "severity": "high" | "medium" | "low",
  "description": "what is wrong and why it matters",
  "scope": "local" | "codebase_wide"
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
        print(f"[backend_logic] AI failed on {file_path} ({e}) — chunk skipped, continuing")
        return []

    findings = []
    for item in items:
        title = item.get("title") or ""
        description = item.get("description") or ""
        findings.append({
            "pillar": "backend_logic",
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

    if not is_relevant_to_pillar(content, "backend_logic"):
        print(f"[relevance_filter] backend_logic: skipping {file_path} (no relevant signals)")
        return []

    chunks = chunk_file_content(content)
    if len(chunks) > 1:
        print(f"[chunker] backend_logic: {file_path} split into {len(chunks)} chunks ({len(content)} chars)")
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


def run_backend_logic_scan(repo_path: str, files: list = None):
    if files is None:
        files = find_relevant_files(repo_path)
    return run_batched_scan(files, BACKEND_LOGIC_KEYWORDS, _scan_batch)