import os
import json
from app.core.ai_client import chat_with_retry, clean_model_output
from app.core.scan_batching import run_batched_scan
from app.core.scope import resolve_scope
from app.core.relevance_filter import is_relevant_to_pillar
from app.core.file_chunker import chunk_file_content, adjust_finding_line

UI_UX_KEYWORDS = ["component", "page", "view", "form", "button", "modal"]


SKIP_PATH_PATTERNS = ["vendor", "third_party", "third-party", "dist", "build", ".min.js", ".min.css", "jquery", "bootstrap"]


def find_frontend_files(repo_path: str):
    relevant = []
    skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", "cloned_repos"}
    extensions = (".jsx", ".tsx", ".js", ".ts", ".html", ".htm", ".vue", ".svelte", ".astro", ".ejs", ".hbs", ".pug", ".css", ".scss", ".sass", ".less")

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for file in files:
            if not file.endswith(extensions):
                continue
            full_path = os.path.join(root, file)
            lower_path = full_path.lower()
            if any(pattern in lower_path for pattern in SKIP_PATH_PATTERNS):
                continue
            if "_fixed" in os.path.splitext(os.path.basename(full_path))[0]:
                continue
            relevant.append(full_path)

    return relevant


def _scan_chunk(file_path: str, chunk_text: str, chunk_start_line: int) -> list:
    if not is_relevant_to_pillar(chunk_text, "ui_ux"):
        print(f"[relevance_filter] ui_ux: skipping a chunk of {file_path} (no relevant signals)")
        return []

    prompt = f"""You are a UI/UX code reviewer. Look at this frontend file and identify UI/UX issues ONLY (buttons with no loading/disabled state during a request, no empty state when a list returns zero items, no error message shown when a request fails, no success feedback after form submission, destructive actions with no confirmation dialog, images with no alt text, interactive elements too small for touch below 44px, forms that reset all fields on a single field error).

Only report issues you can directly observe in the code shown. Do NOT report hypothetical issues (e.g. "if there were images" or "may be too small depending on styling") — only report what is concretely present in this code.

If there are no clear UI/UX issues, return an empty array.

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
        print(f"[ui_ux] AI failed on {file_path} ({e}) — chunk skipped, continuing")
        return []

    findings = []
    for item in items:
        title = item.get("title") or ""
        description = item.get("description") or ""
        findings.append({
            "pillar": "ui_ux",
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

    if not is_relevant_to_pillar(content, "ui_ux"):
        print(f"[relevance_filter] ui_ux: skipping {file_path} (no relevant signals)")
        return []

    chunks = chunk_file_content(content)
    if len(chunks) > 1:
        print(f"[chunker] ui_ux: {file_path} split into {len(chunks)} chunks ({len(content)} chars)")
    all_findings = []
    for chunk in chunks:
        all_findings.extend(_scan_chunk(file_path, chunk["text"], chunk["start_line"]))
    return all_findings

def _scan_batch(file_paths: list) -> list:
    findings = []
    for file_path in file_paths:
        findings.extend(_scan_single_file(file_path))
    return findings


def run_ui_ux_scan(repo_path: str, files: list = None):
    if files is None:
        files = find_frontend_files(repo_path)
    return run_batched_scan(files, UI_UX_KEYWORDS, _scan_batch)