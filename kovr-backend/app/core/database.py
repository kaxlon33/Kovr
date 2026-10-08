import logging
import hashlib
logger = logging.getLogger("kovr")
from sqlalchemy import create_engine, Column, String, Integer, Text, ForeignKey, DateTime, func
from sqlalchemy.orm import declarative_base, sessionmaker
from pgvector.sqlalchemy import Vector
import uuid as uuid_lib
import os
import shutil
import tempfile

from app.core.ai_client import investigate_finding, check_finding_resolved, has_real_patch
from app.core.syntax_check import check_syntax
from app.core.embeddings import generate_embedding
from app.scanner.security import run_gitleaks, run_semgrep
from app.scanner.api_design import run_api_design_scan
from app.scanner.backend_logic import run_backend_logic_scan
from app.core.secret_fix import generate_secret_redaction_fix
from app.core.fix_apply import apply_fix_to_copy
from app.core.cross_file_context import get_enhanced_context
from app.core.code_reader import get_code_context, get_function_context, locate_relevant_line

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://kovr_user:kovr_pass@localhost:5432/kovr")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False)  # user / admin
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Per-user GitHub OAuth token — pull requests are opened under each
    # user's own account. NOTE: production hardening should encrypt this
    # at rest; the database itself is already credentials-protected.
    github_access_token = Column(String)


class Scan(Base):
    __tablename__ = "scans"
    id = Column(String, primary_key=True)
    repo_url = Column(String)
    score = Column(Integer)
    # Nullable on purpose: scans created before auth existed have no owner
    # and remain visible to admins only.
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    # PR lifecycle: the branch KOVR commits verified fixes to, and the
    # pull request once the user explicitly opens one.
    pr_branch = Column(String)
    pr_url = Column(String)


class Finding(Base):
    __tablename__ = "findings"
    id = Column(String, primary_key=True)
    scan_id = Column(String, ForeignKey("scans.id"))
    pillar = Column(String)
    tool = Column(String)
    title = Column(String)
    file = Column(String)
    line = Column(Integer)
    severity = Column(String)
    description = Column(Text)
    root_cause = Column(Text)
    impact = Column(Text)
    attack_path = Column(Text)
    fix_explanation = Column(Text)
    before_code = Column(Text)
    after_code = Column(Text)
    fixed_path = Column(Text)
    verified = Column(String, default="pending")  # pending / resolved / failed
    # Why the last verification failed — shown to the user so a failed
    # auto-fix is never a dead end, and explains that the suggestion was
    # regenerated during the retry loop (so it may differ from earlier).
    last_verify_reason = Column(Text, nullable=True)
    scope = Column(String, default="local")  # local / codebase_wide
    embedding = Column(Vector(384))


def _migrate_columns():
    """create_all never alters existing tables — any column a model gained
    after a database was first created would be missing and crash queries
    with a 500. Postgres' ADD COLUMN IF NOT EXISTS lets us reconcile the
    models against an older schema cheaply and idempotently."""
    from sqlalchemy import text

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            for column in table.columns:
                type_ddl = column.type.compile(engine.dialect)
                conn.execute(
                    text(
                        f'ALTER TABLE "{table.name}" '
                        f'ADD COLUMN IF NOT EXISTS "{column.name}" {type_ddl}'
                    )
                )


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_columns()


def save_scan_results(scan_id: str, repo_url: str, findings_list: list, score: int, user_id: str = None):
    session = SessionLocal()

    scan = Scan(id=scan_id, repo_url=repo_url, score=score, user_id=user_id)
    session.add(scan)
    session.flush()  # force scan to be inserted before findings reference it

    saved_findings = []
    for f in findings_list:
        finding_id = str(uuid_lib.uuid4())
        finding = Finding(
            id=finding_id,
            scan_id=scan_id,
            pillar=f.get("pillar"),
            tool=f.get("tool"),
            title=f.get("title"),
            file=f.get("file"),
            line=f.get("line"),
            severity=f.get("severity"),
            description=f.get("description"),
            scope=f.get("scope", "local"),
        )
        session.add(finding)
        saved_findings.append({**f, "id": finding_id})

    session.commit()
    session.close()

    return scan_id, saved_findings


from app.core.cache import save_to_cache, load_from_cache


SCAN_SKIP_DIRS = {"node_modules", "vendor", "dist", "build", ".git", "third_party", "third-party", ".next", "target"}
SYMBOL_OWNER_EXTENSIONS = {
    ".py", ".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx", ".go", ".java",
    ".rb", ".php", ".rs", ".cs", ".kt", ".swift", ".scala", ".dart",
    ".ex", ".exs", ".lua", ".pl", ".vue", ".svelte",
}
_SYMBOL_STOPWORDS = {"then", "catch", "fetch", "console", "require", "import", "return"}


def _scan_repo_root(finding) -> str:
    """The cloned_repos/<scan_id> root this finding's file belongs to."""
    repo_path = os.path.dirname(finding.file)
    while repo_path and not repo_path.endswith(finding.scan_id) and "cloned_repos" in repo_path:
        parent = os.path.dirname(repo_path)
        if parent == repo_path:
            break
        repo_path = parent
    return repo_path


def _symbols_from_failure(reason: str) -> list:
    """Function-like names a verification failure talks about, e.g.
    'connectDB()' in 'did not add error handling for the connectDB() call'."""
    import re

    names = re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]{3,})\s*\(", reason or "")
    return [n for n in dict.fromkeys(names) if n not in _SYMBOL_STOPWORDS]


def _symbol_defined_in(file_path: str, symbol: str) -> bool:
    """True when file_path DEFINES the symbol (not merely imports/calls it).

    A substring check is wrong here: in the cross-file case the symbol is
    always referenced in the finding's file — that's exactly why the fix
    belongs elsewhere. Only a definition (def/function/func/fn/fun or a
    const/let/var assignment) keeps the fix in this file.
    """
    import re

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(30000)
    except OSError:
        return True  # unreadable — do not retarget on a guess

    def_patterns = (
        f"def {symbol}(",
        f"function {symbol}(",
        f"func {symbol}(",
        f"fn {symbol}(",
        f"fun {symbol}(",
    )
    assignment = re.compile(rf"\b(const|let|var)\s+{re.escape(symbol)}\s*=")
    return any(p in content for p in def_patterns) or bool(assignment.search(content))


def _find_symbol_owner(repo_root: str, symbol: str, current_file: str):
    """The file that DEFINES symbol, other than the finding's own file —
    that is where a cross-file fix must actually be applied."""
    import re

    def_patterns = (
        f"def {symbol}(",
        f"function {symbol}(",
        f"func {symbol}(",
        f"fn {symbol}(",
        f"fun {symbol}(",
    )
    assignment = re.compile(rf"\b(const|let|var)\s+{re.escape(symbol)}\s*=")

    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in SCAN_SKIP_DIRS]
        for name in files:
            if os.path.splitext(name)[1].lower() not in SYMBOL_OWNER_EXTENSIONS:
                continue
            path = os.path.join(root, name)
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(30000)
            except OSError:
                continue
            if any(p in content for p in def_patterns) or assignment.search(content):
                if os.path.abspath(path) != os.path.abspath(current_file):
                    return path
    return None


def _include_element_occurrences(file_path: str, snippet: str, title: str, description: str) -> str:
    """The code the finding talks about must be IN the context.

    Two shapes matter: JSX/component tags ("<Image lacks aria-label")
    and concrete calls ("connectDB() is invoked without error handling").
    When the extracted snippet contains neither — the located line
    drifted, or the call is top-level rather than inside a function —
    append the element's/call's real occurrence from elsewhere in the
    file so the AI patches the right place instead of a no-op nearby.
    """
    import re

    text = f"{title} {description or ''}"
    needles = []
    # Component tags: <Image in the finding text.
    needles.extend(f"<{tag}" for tag in dict.fromkeys(re.findall(r"<([A-Z][A-Za-z0-9]*)", text)))
    # Concrete calls: connectDB() mentioned with parentheses.
    for symbol in dict.fromkeys(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]{2,})\s*\(\s*\)", text)):
        if symbol not in {"the", "and", "for", "not", "with", "if", "else"}:
            needles.append(f"{symbol}(")
    if not needles:
        return snippet

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return snippet

    additions = []
    for needle in dict.fromkeys(needles):
        if needle in snippet:
            continue
        for i, line in enumerate(lines):
            if needle in line:
                start = max(0, i - 12)
                end = min(len(lines), i + 22)
                additions.append(
                    f"<<<ADDITIONAL CONTEXT: occurrence of {needle} elsewhere in this file>>>\n"
                    + "".join(lines[start:end])
                )
                break

    if not additions:
        return snippet
    return snippet + "\n\n" + "\n\n".join(additions)


def _phantom_variables(file_path: str, before_code: str, after_code: str) -> list:
    """Identifiers the patch references that exist NOWHERE — not in the
    original snippet, not declared in the patch, not in the file.

    This is the 'cleanup of uploadedImagePublicId' failure class: the AI
    references a value it never captured, so the cleanup never runs and
    verification fails. Deterministic, so it can force a targeted retry
    before the broken patch is ever applied.
    """
    import re

    keywords = {
        "if", "else", "for", "while", "do", "try", "catch", "finally",
        "return", "const", "let", "var", "function", "async", "await",
        "new", "typeof", "instanceof", "delete", "void", "throw", "switch",
        "case", "break", "continue", "class", "extends", "super", "this",
        "import", "export", "default", "from", "of", "in", "yield",
        "undefined", "null", "true", "false", "require", "then", "static",
        "get", "set", "def", "elif", "except", "raise", "pass", "lambda",
        "with", "as", "not", "and", "or", "is", "None", "True", "False",
    }

    def tokens(code: str) -> set:
        # Strip strings/comments and property accesses (.name) — property
        # and method names are not variable references.
        code = re.sub(r"//[^\n]*|#[^\n]*|/\*.*?\*/", "", code, flags=re.DOTALL)
        code = re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`", "", code, flags=re.DOTALL)
        code = re.sub(r"\.\s*[A-Za-z_$][\w$]*", "", code)
        return set(re.findall(r"[A-Za-z_$][\w$]*", code))

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            file_ids = tokens(f.read())
    except OSError:
        return []

    before_ids = tokens(before_code or "")
    after_ids = tokens(after_code or "")

    # Declared inside the patch itself: const/let/var x, catch (x),
    # function params of newly introduced handlers.
    declared_in_patch = set(
        re.findall(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)", after_code or "")
    ) | set(re.findall(r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)", after_code or ""))

    return sorted(
        name
        for name in after_ids - before_ids - file_ids - declared_in_patch - keywords
        if not name.startswith("_")
    )


def investigate_and_save(finding_id: str, previous_failure_reason: str = None, force_refresh: bool = False):
    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()
    previous_after_code = finding.after_code if finding and previous_failure_reason else None

    if not finding:
        session.close()
        return None

    # Re-opening a finding must show the exact same suggested fix the user
    # already saw. Only an explicit retry (previous_failure_reason from the
    # verify loop, or force_refresh from the "Try automatic fix again"
    # button / a stale patch refresh) may run the AI again. Codebase-wide
    # findings never keep a stored "cannot fix" explanation — they are
    # auto-expanded below so the user only ever sees concrete fixes.
    has_stored_fix = bool(finding.fix_explanation) and bool(finding.after_code or finding.before_code)
    if (
        not previous_failure_reason
        and not force_refresh
        and has_stored_fix
        and finding.scope != "codebase_wide"
    ):
        updated = {
            "id": finding.id,
            "root_cause": finding.root_cause,
            "impact": finding.impact,
            "attack_path": finding.attack_path,
            "fix_explanation": finding.fix_explanation,
            "before_code": finding.before_code or "",
            "after_code": finding.after_code or "",
            "parse_error": False,
            "source": "stored",
            "scope": finding.scope,
        }
        session.close()
        return updated

    if finding.scope == "codebase_wide":
        if finding.tool == "groq_ai":
            effective_line = locate_relevant_line(finding.file, finding.line, finding.title, finding.description)
        else:
            effective_line = finding.line

        code_snippet = get_function_context(finding.file, effective_line)
        code_snippet = get_enhanced_context(finding.file, effective_line, code_snippet)
        code_snippet = _include_element_occurrences(finding.file, code_snippet, finding.title, finding.description)

        finding_dict = {
            "tool": finding.tool,
            "title": finding.title,
            "file": finding.file,
            "line": finding.line,
            "description": finding.description,
        }

        try:
            trial_result = investigate_finding(finding_dict, code_snippet=code_snippet)
        except Exception:
            trial_result = None

        if trial_result and has_real_patch(trial_result):
            finding.scope = "local"
            finding.root_cause = trial_result.get("root_cause")
            finding.impact = trial_result.get("impact")
            finding.attack_path = trial_result.get("attack_path")
            finding.fix_explanation = trial_result.get("fix_explanation")
            finding.before_code = trial_result.get("before_code") or ""
            finding.after_code = trial_result.get("after_code") or ""
            session.commit()
            session.refresh(finding)
            updated = {
                "id": finding.id,
                "root_cause": finding.root_cause,
                "impact": finding.impact,
                "attack_path": finding.attack_path,
                "fix_explanation": finding.fix_explanation,
                "before_code": finding.before_code,
                "after_code": finding.after_code,
                "parse_error": False,
                "source": "live",
                "scope": "local",
            }
            session.close()
            return updated

        # No single-file patch is possible — split it automatically instead
        # of showing a manual "find and fix everywhere" step. The user only
        # ever sees concrete, single-file findings with real suggestions.
        expanded = expand_codebase_wide_finding(finding_id)
        session.close()
        return {
            "status": "expanded",
            "new_finding_ids": expanded.get("new_finding_ids", []),
        }

    if finding.scope == "redirect":
        repo_path = os.path.dirname(finding.file)
        while repo_path and not repo_path.endswith(finding.scan_id) and "cloned_repos" in repo_path:
            parent = os.path.dirname(repo_path)
            if parent == repo_path:
                break
            repo_path = parent

        from app.core.pattern_scan import find_mounting_entry_file
        target_file = find_mounting_entry_file(repo_path, os.path.basename(finding.file))
        if target_file and os.path.exists(target_file):
            try:
                with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                    code_snippet = f.read()[:6000]

                target_finding = {
                    "tool": finding.tool,
                    "title": finding.title,
                    "file": target_file,
                    "line": 1,
                    "description": f"{finding.description} (Configure router prefix or versioning at this mount point)."
                }
                result = investigate_finding(target_finding, code_snippet=code_snippet, previous_failure_reason=previous_failure_reason, previous_after_code=previous_after_code)
                finding.root_cause = result.get("root_cause")
                finding.impact = result.get("impact")
                finding.attack_path = result.get("attack_path")
                finding.fix_explanation = f"Applied in entry file {os.path.basename(target_file)}: {result.get('fix_explanation')}"
                finding.before_code = result.get("before_code") or ""
                finding.after_code = result.get("after_code") or ""
                finding.file = target_file  # Patch target file instead of the route file
                session.commit()
                session.refresh(finding)
                updated = {
                    "id": finding.id,
                    "file": finding.file,
                    "root_cause": finding.root_cause,
                    "impact": finding.impact,
                    "attack_path": finding.attack_path,
                    "fix_explanation": finding.fix_explanation,
                    "before_code": finding.before_code,
                    "after_code": finding.after_code,
                    "parse_error": result.get("parse_error", False),
                    "source": "live",
                    "scope": "redirect"
                }
                session.close()
                return updated
            except Exception as e:
                pass

    # Cross-file re-target: a failed verification often means the real fix
    # lives in a DIFFERENT file — e.g. "did not add error handling for the
    # connectDB() call" when connectDB() is defined in the db module, not
    # the file this finding points at. Locate the symbol's owning file and
    # re-aim the finding there, so the regenerated patch, the apply, and
    # the re-verification all target the code that actually owns the issue.
    if previous_failure_reason:
        repo_root = _scan_repo_root(finding)
        if repo_root and os.path.isdir(repo_root):
            for symbol in _symbols_from_failure(previous_failure_reason):
                # "error handling AROUND connectDB()" means the call site —
                # which is in the finding's own file. Retargeting to the
                # definition would move the fix away from where it belongs.
                import re as _re

                if _re.search(
                    rf"(around|before|after)\s+(the\s+)?{ _re.escape(symbol) }\s*\(", previous_failure_reason
                ) or _re.search(rf"(call|invocation)\s+(to|of)\s+{ _re.escape(symbol) }", previous_failure_reason):
                    continue
                if _symbol_defined_in(finding.file, symbol):
                    continue  # defined here already — not a cross-file case
                owner = _find_symbol_owner(repo_root, symbol, finding.file)
                if owner:
                    print(f"[cross-file] re-targeting finding {finding_id} at {owner} (owns {symbol})")
                    finding.file = owner
                    finding.line = 1
                    finding.before_code = ""
                    finding.after_code = ""
                    finding.fix_explanation = None
                    session.commit()
                    previous_after_code = None
                    break

    if finding.tool == "groq_ai":
        effective_line = locate_relevant_line(finding.file, finding.line, finding.title, finding.description)
    else:
        effective_line = finding.line

    pattern_indicators = ("consisten", "convention", "pattern", "mix", "mixing")
    is_pattern_issue = any(kw in (finding.description or "").lower() for kw in pattern_indicators)

    if is_pattern_issue:
        try:
            with open(finding.file, "r", encoding="utf-8", errors="replace") as f:
                full_file = f.read()
            # Cap to a reasonable size so this doesn't blow up token usage
            code_snippet = full_file[:6000]
        except Exception:
            code_snippet = get_function_context(finding.file, effective_line)
    else:
        code_snippet = get_function_context(finding.file, effective_line)

    code_snippet = get_enhanced_context(finding.file, effective_line, code_snippet)
    code_snippet = _include_element_occurrences(finding.file, code_snippet, finding.title, finding.description)

    finding_dict = {
        "tool": finding.tool,
        "title": finding.title,
        "file": finding.file,
        "line": finding.line,
        "description": finding.description
    }

    try:
        result = investigate_finding(finding_dict, code_snippet=code_snippet, previous_failure_reason=previous_failure_reason, previous_after_code=previous_after_code)

        # Context escalation: when the extracted snippet was too narrow
        # (nested callbacks, long functions — the AI reports it can't see
        # the full function and refuses to patch), retry ONCE with the
        # whole file, bounded. A refused fix is worthless; a wider window
        # usually produces a real patch.
        if (not result.get("after_code") or result.get("auto_fix_unavailable")) and not previous_failure_reason:
            try:
                with open(finding.file, "r", encoding="utf-8", errors="replace") as f:
                    wide_context = f.read()[:12000]
                if len(wide_context) > len(code_snippet) + 200:
                    retry = investigate_finding(
                        finding_dict,
                        code_snippet=wide_context,
                        previous_failure_reason=(
                            "The earlier code snippet was incomplete for this finding — "
                            "a much larger portion of the file is provided now. Produce a "
                            "concrete before_code/after_code from this wider context."
                        ),
                        previous_after_code=previous_after_code,
                    )
                    if retry.get("after_code"):
                        result = retry
            except Exception:
                pass

        # Phantom-variable guard: a patch that references identifiers which
        # exist nowhere (the classic "cleanup uses a value that was never
        # captured" bug) fixes nothing. Reject it and force ONE coordinated
        # retry with the whole file visible and the exact problem named.
        phantoms = _phantom_variables(
            finding.file, result.get("before_code") or "", result.get("after_code") or ""
        )
        if phantoms and result.get("after_code"):
            phantom_note = (
                f"Your previous patch referenced variable(s) that do not exist anywhere "
                f"in the file: {', '.join(phantoms)}. The value was never captured where it "
                f"is produced. Regenerate the complete function and, in the SAME patch, add "
                f"the capturing assignment at the production site (e.g. capture the upload/"
                f"creation result into a variable) before referencing it in the error handling."
            )
            try:
                with open(finding.file, "r", encoding="utf-8", errors="replace") as f:
                    wide_file = f.read()[:12000]
                retry = investigate_finding(
                    finding_dict,
                    code_snippet=wide_file if len(wide_file) > len(code_snippet) else code_snippet,
                    previous_failure_reason=phantom_note,
                    previous_after_code=result.get("after_code"),
                )
                retry_phantoms = _phantom_variables(
                    finding.file, retry.get("before_code") or "", retry.get("after_code") or ""
                )
                if retry.get("after_code") and not retry_phantoms:
                    result = retry
            except Exception:
                pass

        save_to_cache(f"investigate_{finding_id}", result)
        source = "live"
    except Exception as e:
        cached = load_from_cache(f"investigate_{finding_id}")
        if cached is not None:
            result = cached
            source = "cached"
        else:
            session.close()
            error_type = "quota_exceeded" if "quota" in str(e).lower() or "tokens per day" in str(e).lower() else "investigation_failed"
            return {"error": f"Investigation failed and no cached result available: {e}", "error_type": error_type}

    finding.root_cause = result.get("root_cause")
    finding.impact = result.get("impact")
    finding.attack_path = result.get("attack_path")
    finding.fix_explanation = result.get("fix_explanation")

    if finding.tool == "gitleaks":
        # Secrets get a deterministic fix, not an AI-guessed one — reliability
        # matters more than flexibility for this category of finding.
        before, after = generate_secret_redaction_fix(finding.file, finding.line)
        finding.before_code = before
        finding.after_code = after
    else:
        finding.before_code = result.get("before_code") or ""
        finding.after_code = result.get("after_code") or ""

    embedding_text = f"{finding.title} {finding.description} {finding.root_cause}"
    finding.embedding = generate_embedding(embedding_text)

    session.commit()
    session.refresh(finding)

    updated = {
        "id": finding.id,
        "root_cause": finding.root_cause,
        "impact": finding.impact,
        "attack_path": finding.attack_path,
        "fix_explanation": finding.fix_explanation,
        "before_code": finding.before_code,
        "after_code": finding.after_code,
        "parse_error": result.get("parse_error", False),
        "source": source,
        "scope": finding.scope
    }

    session.close()
    return updated


def find_similar_findings(finding_id: str, limit: int = 3):
    session = SessionLocal()
    target = session.query(Finding).filter(Finding.id == finding_id).first()

    if not target or target.embedding is None:
        session.close()
        return []

    similar = (
        session.query(Finding)
        .filter(Finding.id != finding_id)
        .filter(Finding.embedding.isnot(None))
        .order_by(Finding.embedding.cosine_distance(target.embedding))
        .limit(limit)
        .all()
    )

    results = [
        {
            "id": f.id,
            "title": f.title,
            "file": f.file,
            "severity": f.severity,
            "description": f.description
        }
        for f in similar
    ]

    session.close()
    return results


MAX_APPLY_RETRIES = 2


def apply_fix_for_finding(finding_id: str, _retry_count: int = 0):
    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()

    if not finding:
        session.close()
        return None, "Finding not found"

    if finding.scope == "codebase_wide":
        session.close()
        return None, "codebase_wide_scope"

    if not finding.before_code or not finding.after_code:
        session.close()
        return None, "No fix available for this finding"

    fixed_path, error = apply_fix_to_copy(finding.file, finding.before_code, finding.after_code)

    if error == "Original file not found":
        # The working copy was cleaned up. When an archived fix-branch
        # bundle exists (any earlier verified fix), rebuild the copy from
        # it so this OLD scan can still receive NEW fixes — the tree is at
        # the fix branch, i.e. resolved findings stay resolved.
        from app.core.git_ops import restore_fix_branch

        restore_fix_branch(finding.scan_id)
        fixed_path, error = apply_fix_to_copy(finding.file, finding.before_code, finding.after_code)

        if error == "Original file not found":
            session.close()
            return None, (
                "The working copy of this repository is no longer on the server "
                "(copies are kept while a scan still has fixes to approve, then cleaned up — "
                "with a 7-day limit). Re-scan the repository and approve the fix there."
            )

    if not error:
        finding.fixed_path = fixed_path
        session.commit()
        session.close()
        return fixed_path, None

    session.close()

    # The file content this finding's before_code was captured against may
    # have shifted (another finding in the same file was fixed first, or the
    # AI's transcription of before_code was slightly off). Re-investigate
    # against the CURRENT file state and retry the apply, up to
    # MAX_APPLY_RETRIES times, before giving up.
    stale_patch = "does not match file content exactly" in (error or "")
    if stale_patch and _retry_count < MAX_APPLY_RETRIES:
        refreshed = investigate_and_save(finding_id, force_refresh=True)
        if refreshed and not refreshed.get("error"):
            return apply_fix_for_finding(finding_id, _retry_count=_retry_count + 1)

    return None, error


def expand_codebase_wide_finding(finding_id: str, with_fixes: bool = True):
    """
    Step 4: turns a codebase_wide finding into several ordinary local
    findings — one per affected file (the original file plus every file
    Step 2 finds with the same issue). Each new finding goes through the
    normal fix pipeline. The original finding is marked "superseded" so
    it drops out of the active findings list and the score calculation,
    without being deleted.

    with_fixes=True generates each fix immediately (used when the user
    opens an umbrella finding). with_fixes=False only splits — the new
    findings carry no fix yet and are investigated lazily, exactly like
    every other finding; used at scan completion so unfixable umbrellas
    never appear in any findings list while keeping AI cost bounded.
    """
    from app.core.pattern_scan import find_pattern_locations, generate_fix_for_location

    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()

    if not finding:
        session.close()
        return {"error": "Finding not found"}

    if finding.scope != "codebase_wide":
        session.close()
        return {"error": "This finding is not codebase_wide"}

    repo_path = os.path.dirname(finding.file)
    # Walk up to the repo root (cloned_repos/<scan_id>) from the finding's file path
    while repo_path and not repo_path.endswith(finding.scan_id) and "cloned_repos" in repo_path:
        parent = os.path.dirname(repo_path)
        if parent == repo_path:
            break
        repo_path = parent

    other_locations = []
    try:
        other_locations = find_pattern_locations(
            finding_pillar=finding.pillar,
            finding_title=finding.title,
            finding_description=finding.description,
            repo_path=repo_path,
            exclude_file=finding.file,
        )
    except Exception as e:
        # The pattern search must never keep the umbrella alive — fall
        # back to splitting into the original file only.
        print(f"[expand] pattern search failed for {finding_id[:8]}: {e}")

    all_locations = [finding.file] + other_locations
    new_finding_ids = []

    for file_path in all_locations:
        fix = (
            generate_fix_for_location(
                file_path=file_path,
                finding_title=finding.title,
                finding_description=finding.description,
                finding_line=finding.line if file_path == finding.file else None,
            )
            if with_fixes
            else {}
        )

        new_id = str(uuid_lib.uuid4())
        new_finding = Finding(
            id=new_id,
            scan_id=finding.scan_id,
            pillar=finding.pillar,
            tool="groq_ai",
            title=finding.title,
            file=file_path,
            line=finding.line if file_path == finding.file else None,
            severity=finding.severity,
            description=finding.description,
            root_cause=fix.get("root_cause"),
            impact=fix.get("impact"),
            attack_path=fix.get("attack_path"),
            fix_explanation=fix.get("fix_explanation"),
            before_code=fix.get("before_code") or "",
            after_code=fix.get("after_code") or "",
            scope="local",
        )
        session.add(new_finding)
        new_finding_ids.append(new_id)

    finding.verified = "superseded"
    session.commit()
    session.close()

    return {"finding_id": finding_id, "status": "expanded", "new_finding_ids": new_finding_ids}
MAX_FIX_ATTEMPTS = 3


def _record_verify_outcome(finding_id: str, reason: str | None):
    """Persist the last verification outcome on the finding so the UI can
    explain a failure long after the verify call returned. reason=None on
    success clears any earlier failure note."""
    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()
    if finding:
        finding.last_verify_reason = reason
        session.commit()
    session.close()


def verify_with_retry(finding_id: str, fixed_path: str, attempt: int = 1, _seen_patches=None):
    """
    Runs verify_fix once. If the fix failed (not resolved), retries by
    re-investigating (with the failure reason, so the AI can target the
    real location) and re-applying a fresh fix, up to MAX_FIX_ATTEMPTS
    total attempts. If still unresolved after all attempts, the result is
    flagged needs_manual_context instead of looping forever.

    An oscillation guard stops the loop early when a regenerated patch is
    byte-identical to one that already failed — re-verifying it can only
    produce the same verdict and burns attempts for nothing.
    """
    if _seen_patches is None:
        _seen_patches = set()

    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()
    current_patch = (finding.after_code or "") if finding else ""
    session.close()
    if current_patch:
        patch_hash = hashlib.sha256(current_patch.encode("utf-8")).hexdigest()
        if patch_hash in _seen_patches:
            reason = (
                "The regenerated fix is identical to a previous failed attempt — "
                "the AI could not improve on it. Manual review needed."
            )
            _record_verify_outcome(finding_id, reason)
            return {
                "finding_id": finding_id,
                "verified": "failed",
                "reason": reason,
                "attempts": attempt,
                "retries_exhausted": True,
                "needs_manual_context": True,
            }
        _seen_patches.add(patch_hash)

    result = verify_fix(finding_id, fixed_path)

    if result.get("verified") == "resolved":
        result["attempts"] = attempt
        _record_verify_outcome(finding_id, None)
        return result

    if attempt >= MAX_FIX_ATTEMPTS:
        result["attempts"] = attempt
        result["retries_exhausted"] = True
        result["needs_manual_context"] = True
        _record_verify_outcome(finding_id, result.get("reason"))
        result["note"] = (
            "The suggestion shown is the final attempt — the fix was regenerated automatically "
            "after each failed verification, so it may differ from the version you first saw."
        )
        return result

    new_investigation = investigate_and_save(finding_id, previous_failure_reason=result.get("reason"))
    if not new_investigation or new_investigation.get("error"):
        result["attempts"] = attempt
        result["retries_exhausted"] = True
        result["needs_manual_context"] = True
        _record_verify_outcome(finding_id, new_investigation.get("error") or result.get("reason"))
        return result

    new_fixed_path, error = apply_fix_for_finding(finding_id)
    if error or not new_fixed_path:
        result["attempts"] = attempt
        result["retries_exhausted"] = True
        result["needs_manual_context"] = True
        _record_verify_outcome(finding_id, error or result.get("reason"))
        return result

    return verify_with_retry(finding_id, new_fixed_path, attempt + 1, _seen_patches=_seen_patches)


def _window_around_patch(fixed_code: str, patch: str, before: int = 1200, after: int = 1800) -> str:
    """A snippet of the fixed file CENTERED on where the patch landed.

    verify_fix must judge the patched component, and the patch is often
    deeper in the file than a head-truncation would show — without this,
    real fixes get falsely reported as 'still detected'.
    """
    if not patch:
        return ""
    needles = [line.strip() for line in patch.splitlines()]
    needles = [line for line in needles if len(line) >= 15]
    for needle in needles:
        idx = fixed_code.find(needle)
        if idx != -1:
            start = max(0, idx - before)
            return fixed_code[start : idx + after]
    return ""


def verify_fix(finding_id: str, fixed_path: str):
    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()

    if not finding:
        session.close()
        return {"error": "Finding not found"}

    if finding.tool == "gitleaks":
        new_findings = run_gitleaks(fixed_path)
        still_present = any(
            f.get("title") == finding.title and f.get("line") == finding.line
            for f in new_findings
        )
        result_reason = "Re-scanned with Gitleaks"
    elif finding.tool == "semgrep":
        new_findings = run_semgrep(fixed_path)
        still_present = any(
            f.get("title") == finding.title and f.get("line") == finding.line
            for f in new_findings
        )
        result_reason = "Re-scanned with Semgrep"
    else:
        # Deterministic gate BEFORE the model judge: a patch that cannot
        # even parse is wrong regardless of what the verifier says, and
        # the syntax error feeds back into the retry loop as a precise
        # failure reason the next attempt can target.
        syntax = check_syntax(fixed_path)
        if syntax is not None and not syntax.get("ok"):
            session.close()
            return {
                "finding_id": finding_id,
                "verified": "failed",
                "reason": (
                    "Patched file fails to compile: "
                    f"{syntax.get('message') or 'syntax error'}"
                ),
            }

        try:
            with open(fixed_path, "r", encoding="utf-8", errors="replace") as f:
                fixed_code = f.read()
        except FileNotFoundError:
            session.close()
            return {"error": "Fixed file not found"}

        verify_description = finding.description or ""
        if finding.scope == "redirect":
            verify_description += (
                " (Note: For this architectural issue, the fix was applied to the router mounting "
                "entry point by adding a version prefix like /api/v1 to app.use() or router mounting)."
            )

        result = check_finding_resolved(
            title=finding.title,
            description=verify_description,
            before_code=finding.before_code or "",
            fixed_code=fixed_code,
            after_code=finding.after_code or "",
            file_context=_window_around_patch(fixed_code, finding.after_code or ""),
        )

        if result.get("verify_error"):
            session.close()
            return {"finding_id": finding_id, "verified": "error", "reason": result.get("reason")}

        resolved_flag = result.get("resolved")
        if resolved_flag is None:
            # No verdict (null/missing 'resolved') is NOT a failure — treat
            # it as an error so the retry loop regenerates instead of
            # wrongly marking a correct fix as failed.
            session.close()
            return {
                "finding_id": finding_id,
                "verified": "error",
                "reason": f"Verification returned no verdict: {result.get('reason')}",
            }

        still_present = not resolved_flag
        result_reason = result.get("reason")

    finding.verified = "failed" if still_present else "resolved"
    finding.last_verify_reason = result_reason
    session.commit()
    status = finding.verified

    # Once verified as genuinely resolved, finalize by overwriting the
    # original file with the fixed content — the copy has proven itself.
    if status == "resolved":
        try:
            shutil.copy(fixed_path, finding.file)
            logger.info(f"Fix finalized: {fixed_path} -> {finding.file}")
        except Exception as e:
            logger.error(f"Failed to finalize fix for finding {finding_id}: {e}")

    session.close()

    return {"finding_id": finding_id, "verified": status, "reason": result_reason}