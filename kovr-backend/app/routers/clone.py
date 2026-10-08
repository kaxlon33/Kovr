import shutil
import os
from urllib.parse import urlparse

from sqlalchemy import func
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.scanner.security import run_gitleaks, run_semgrep
from app.scanner.api_design import run_api_design_scan, find_relevant_files
from app.scanner.backend_logic import run_backend_logic_scan
from app.scanner.ui_ux import run_ui_ux_scan, find_frontend_files
from app.core.score import calculate_score
from app.core.database import SessionLocal, Finding, Scan, User, verify_with_retry
from app.core.fix_apply import apply_fix_to_copy
from app.core.cache import save_to_cache, load_from_cache
from app.core.progress import (
    init_scan_progress, update_pillar_progress, mark_scan_complete,
    get_scan_progress, get_scan_owner, active_scan_count,
    request_scan_cancel, set_scan_paused, is_scan_cancelled, clear_scan_control,
    incomplete_scan_ids, note_repo_url, get_repo_url,
)
from app.core.ai_client import set_current_scan, ScanCancelledError
from app.core.git_ops import rmtree as rmtree_git_safe
from app.core.database import save_scan_results, investigate_and_save, find_similar_findings, apply_fix_for_finding, expand_codebase_wide_finding
from app.routers.auth import get_current_user
from fastapi.responses import StreamingResponse
from app.core.score import calculate_score
import threading
import time
import json
import git
import uuid

router = APIRouter()


def _can_access_scan(scan: Scan, user: User) -> bool:
    """Admins see everything; users see their own scans. Scans without an
    owner (created before auth existed) are admin-only."""
    return user.role == "admin" or scan.user_id == user.id


def get_owned_finding(
    finding_id: str,
    current_user: User = Depends(get_current_user),
) -> Finding:
    """Loads a finding and enforces scan ownership. Returns 404 (not 403)
    for other people's findings so scan existence is never confirmed."""
    session = SessionLocal()
    try:
        row = (
            session.query(Finding, Scan)
            .join(Scan, Finding.scan_id == Scan.id)
            .filter(Finding.id == finding_id)
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Finding not found")
        finding, scan = row
        if not _can_access_scan(scan, current_user):
            raise HTTPException(status_code=404, detail="Finding not found")
        return finding
    finally:
        session.close()


class CloneRequest(BaseModel):
    repo_url: str


MAX_REPO_SIZE_MB = 500      # loose safety net against absurdly large clones
MAX_SCANNABLE_FILES = 300   # the real control on scan time (each file = an AI call)

# SSRF guard: repo_url is user-controlled, and git will happily clone from
# arbitrary URLs — including internal addresses only the server can reach.
# Only public repositories over https, on known git hosts, may be cloned.
ALLOWED_REPO_HOSTS = {
    "github.com",
    "www.github.com",
    "gitlab.com",
    "www.gitlab.com",
    "bitbucket.org",
    "www.bitbucket.org",
}


def validate_repo_url(repo_url: str) -> str | None:
    """Returns an error message when the URL is not an allowed public repo."""
    parsed = urlparse(repo_url or "")
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_REPO_HOSTS:
        return (
            "Only https repositories from github.com, gitlab.com or bitbucket.org can be scanned."
        )
    # Needs at least owner/repo in the path — blocks the bare host itself.
    path_parts = [part for part in (parsed.path or "").strip("/").split("/") if part]
    if len(path_parts) < 2:
        return "That URL does not look like a repository — use https://host/owner/repo."
    return None


# Concurrency cap: each scan runs 4 analyzer threads and hundreds of AI
# calls — more than this many at once would swamp a small instance.
MAX_CONCURRENT_SCANS = 2
# Clone retention: a scan's working copy is PRESERVED while that scan still
# has findings left to fix, and cleaned up once the work is finished — so
# users can come back days later and keep approving fixes. A hard age cap
# stops abandoned scans from occupying the disk forever.
CLONE_GRACE_HOURS = 24.0      # after this, a finished scan's copy may go
CLONE_HARD_CAP_DAYS = 7.0     # regardless of pending work, older than this goes


def _scan_has_pending_fixes(scan_id: str) -> bool:
    """True while the scan still has actionable findings (pending or failed
    verification — both can be approved/retried)."""
    from app.core.database import SessionLocal, Finding

    session = SessionLocal()
    try:
        count = (
            session.query(Finding)
            .filter(Finding.scan_id == scan_id)
            .filter(Finding.verified.notin_(["resolved", "superseded"]))
            .count()
        )
        return count > 0
    finally:
        session.close()


def _cleanup_old_clones(exclude_scan_id: str = ""):
    """Remove working copies whose workflow is complete (or past the hard
    cap). Runs at the start of each new scan so the disk never grows
    without bound, without yanking a copy out from under unfinished work.

    A copy with unpushed verified fixes gets its fix branch archived to a
    small bundle first, so "Open Pull Request" still works long after the
    clone itself is gone."""
    clone_root = "cloned_repos"
    if not os.path.isdir(clone_root):
        return
    now = time.time()
    for name in os.listdir(clone_root):
        path = os.path.join(clone_root, name)
        if name == exclude_scan_id or not os.path.isdir(path):
            continue
        try:
            age_hours = (now - os.path.getmtime(path)) / 3600
            expired = (
                age_hours > CLONE_HARD_CAP_DAYS * 24
                or (age_hours > CLONE_GRACE_HOURS and not _scan_has_pending_fixes(name))
            )
            if expired:
                _archive_if_unpushed(name)
                rmtree_git_safe(path)
        except OSError:
            pass


def _archive_if_unpushed(scan_id: str) -> None:
    """Archive the fix branch if commits exist and no PR has been opened —
    cleanup must never destroy verified, unpushed work."""
    from app.core.git_ops import archive_fix_branch

    try:
        session = SessionLocal()
        try:
            scan = session.query(Scan).filter(Scan.id == scan_id).first()
            if scan and scan.pr_branch and not scan.pr_url:
                archive_fix_branch(f"cloned_repos/{scan_id}", scan_id)
        finally:
            session.close()
    except Exception as e:
        print(f"[pr] WARNING: archive check failed for {scan_id[:8]}: {e}")


def _get_folder_size_mb(path: str) -> float:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total / (1024 * 1024)


@router.post("/api/clone")
def clone_repo(request: CloneRequest, current_user: User = Depends(get_current_user)):
    # SSRF gate first — nothing is cloned from an unapproved host.
    url_error = validate_repo_url(request.repo_url)
    if url_error:
        return {"error": url_error, "status": "rejected"}

    scan_id = str(uuid.uuid4())
    target_path = f"cloned_repos/{scan_id}"

    # Shallow clone (depth=1) — much faster/smaller than a full clone
    # regardless of the repo's history, and lets us check before
    # committing to a full scan.
    git.Repo.clone_from(request.repo_url, target_path, depth=1)

    size_mb = _get_folder_size_mb(target_path)
    if size_mb > MAX_REPO_SIZE_MB:
        rmtree_git_safe(target_path)
        return {
            "error": f"Repository is too large to scan ({size_mb:.1f} MB, limit is {MAX_REPO_SIZE_MB} MB). Please choose a smaller repository.",
            "status": "rejected"
        }

    from app.scanner.api_design import find_relevant_files
    from app.scanner.ui_ux import find_frontend_files
    file_count = len(set(find_relevant_files(target_path)) | set(find_frontend_files(target_path)))

    if file_count > MAX_SCANNABLE_FILES:
        rmtree_git_safe(target_path)
        return {
            "error": f"Repository has too many scannable files ({file_count}, limit is {MAX_SCANNABLE_FILES}). Please choose a smaller repository or one with fewer source files.",
            "status": "rejected"
        }

    return {
        "scan_id": scan_id,
        "path": target_path,
        "repo_url": request.repo_url,
        "status": "cloned"
    }

@router.get("/api/finding/{finding_id}/similar")
def similar_findings_endpoint(finding_id: str, _finding: Finding = Depends(get_owned_finding)):
    results = find_similar_findings(finding_id)
    return {"similar_findings": results}


class FixDecision(BaseModel):
    action: str  # "approve" or "reject"


@router.get("/api/finding/{finding_id}/investigate")
def investigate_endpoint(finding_id: str, _finding: Finding = Depends(get_owned_finding), refresh: bool = False):
    # Plain opens get the stored investigation so the suggested fix stays
    # stable; ?refresh=true deliberately regenerates it.
    result = investigate_and_save(finding_id, force_refresh=refresh)
    if not result:
        return {"error": "Finding not found"}
    return result


@router.post("/api/finding/{finding_id}/fix")
def fix_decision(finding_id: str, decision: FixDecision, _finding: Finding = Depends(get_owned_finding)):
    if decision.action != "approve":
        return {"finding_id": finding_id, "action": decision.action, "status": "recorded"}

    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()

    if not finding:
        session.close()
        return {"error": "Finding not found"}

    if finding.scope == "codebase_wide":
        session.close()
        return {
            "finding_id": finding_id,
            "status": "codebase_wide",
            "error": "This finding requires a codebase-wide review and cannot be auto-fixed."
        }

    if not finding.before_code or not finding.after_code:
        session.close()
        return {"error": "This finding has no fix available yet. Run investigate first."}
    session.close()

    fixed_path, error = apply_fix_for_finding(finding_id)

    if error:
        return {"finding_id": finding_id, "status": "failed", "error": error}

    return {"finding_id": finding_id, "status": "fix_applied", "fixed_path": fixed_path}

@router.post("/api/finding/{finding_id}/expand")
def expand_finding(finding_id: str, _finding: Finding = Depends(get_owned_finding)):
    result = expand_codebase_wide_finding(finding_id)
    return result

@router.post("/api/finding/{finding_id}/verify")
def verify_endpoint(finding_id: str, _finding: Finding = Depends(get_owned_finding)):
    session = SessionLocal()
    finding = session.query(Finding).filter(Finding.id == finding_id).first()
    if not finding or not finding.fixed_path:
        session.close()
        return {"error": "No fix has been applied yet for this finding"}
    fixed_path = finding.fixed_path
    scan_id = finding.scan_id
    repo_root = f"cloned_repos/{scan_id}"
    session.close()

    try:
        result = verify_with_retry(finding_id, fixed_path)
    except Exception as e:
        return {"finding_id": finding_id, "verified": "unknown", "reason": str(e), "error": str(e)}

    # PR lifecycle: a VERIFIED fix is committed to the scan's branch
    # immediately (kovr/fix-{scan_id}), one commit per finding. Nothing is
    # pushed anywhere until the user explicitly opens a pull request.
    if isinstance(result, dict) and result.get("verified") == "resolved" and os.path.isdir(repo_root):
        try:
            from app.core.git_ops import commit_finding_fix, fix_branch_name

            rel_path = os.path.relpath(fixed_path, repo_root).replace("\\", "/")
            committed = commit_finding_fix(
                repo_root, scan_id, rel_path, finding_id, _finding.title
            )
            if committed:
                print(f"[pr] committed verified fix for {finding_id[:8]} to {fix_branch_name(scan_id)}")
                session = SessionLocal()
                scan = session.query(Scan).filter(Scan.id == scan_id).first()
                if scan and not scan.pr_branch:
                    scan.pr_branch = fix_branch_name(scan_id)
                    session.commit()
                session.close()
        except Exception as e:
            # A commit problem must never fail the verification itself.
            print(f"[pr] WARNING: could not commit fix for {finding_id[:8]}: {e}")

    return result


# ── Pull-request lifecycle ─────────────────────────────────────────────────


def _pr_access(scan_id: str, current_user: User):
    session = SessionLocal()
    scan = session.query(Scan).filter(Scan.id == scan_id).first()
    if not scan or not _can_access_scan(scan, current_user):
        session.close()
        return None, None, "Scan not found"
    return scan, session, None


@router.get("/api/scan/{scan_id}/pr")
def pr_status_endpoint(scan_id: str, current_user: User = Depends(get_current_user)):
    from app.core.git_ops import archived_fix_branch, branch_commit_messages, fix_branch_name
    from app.routers.github_auth import user_github_token

    scan, session, error = _pr_access(scan_id, current_user)
    if error:
        return {"error": error}

    repo_root = f"cloned_repos/{scan_id}"
    clone_available = os.path.isdir(repo_root)
    # The clone may be gone while its archived fix branch lives on — the
    # PR flow restores from the bundle on demand, so treat it as available.
    archived = archived_fix_branch(scan_id) if not clone_available else None
    session.close()

    commits = (
        branch_commit_messages(repo_root, scan_id) if clone_available
        else (archived["commit_messages"] if archived else [])
    )

    return {
        "branch": scan.pr_branch or fix_branch_name(scan_id),
        "clone_available": clone_available or bool(archived),
        "commit_count": len(commits),
        "commit_messages": commits[:30],
        "pr_url": scan.pr_url,
        # Pull requests open under the CURRENT USER's GitHub connection.
        "token_configured": bool(user_github_token(current_user)),
    }


@router.post("/api/scan/{scan_id}/pr")
def open_pr_endpoint(scan_id: str, current_user: User = Depends(get_current_user)):
    from app.core.git_ops import branch_commit_messages, changed_files, fix_branch_name, push_branch
    from app.core.github_api import get_default_branch, open_pull_request

    scan, session, error = _pr_access(scan_id, current_user)
    if error:
        return {"error": error}

    # Explicit and once: an already-open PR is returned as-is.
    if scan.pr_url:
        url = scan.pr_url
        session.close()
        return {"pr_url": url, "already_open": True}

    # Pull requests open under the CURRENT USER's own GitHub connection —
    # the server-wide token is only a self-hosted fallback.
    from app.routers.github_auth import user_github_token

    token = user_github_token(current_user)
    if not token:
        session.close()
        return {
            "error": "No GitHub account connected — connect yours in Settings "
            "(or set GITHUB_TOKEN on the server) to open pull requests."
        }

    repo_root = f"cloned_repos/{scan_id}"
    if not os.path.isdir(repo_root):
        # The working copy was cleaned up — restore it from the archived
        # fix-branch bundle so old, unpushed fixes can still become a PR.
        from app.core.git_ops import restore_fix_branch

        repo_root = restore_fix_branch(scan_id)
        if not repo_root:
            session.close()
            return {"error": "The scanned clone is no longer on disk — re-scan the repository first."}

    commits = branch_commit_messages(repo_root, scan_id)
    if not commits:
        session.close()
        return {"error": "No verified fixes have been committed yet — approve fixes first."}

    # Safety net: re-scan the branch diff for secrets before anything
    # leaves the machine. Pre-existing (still-open) gitleaks findings are
    # not a blocker; anything NEW in the changed files is.
    try:
        changed = set(changed_files(repo_root))
        known_secrets = {
            (f.title, os.path.relpath(f.file, repo_root).replace("\\", "/"))
            for f in session.query(Finding).filter(
                Finding.scan_id == scan_id, Finding.tool == "gitleaks"
            ).all()
        }
        leaks = []
        for leak in run_gitleaks(repo_root):
            rel = os.path.relpath(leak.get("file", ""), repo_root).replace("\\", "/")
            if rel in changed and (leak.get("title"), rel) not in known_secrets:
                leaks.append({"title": leak.get("title"), "file": rel, "line": leak.get("line")})
        if leaks:
            session.close()
            return {
                "error": "Pull request blocked — possible secrets detected in the fixed code.",
                "findings": leaks,
            }
    except Exception as e:
        session.close()
        return {"error": f"The pre-push secret scan failed, so nothing was pushed: {e}"}

    branch = fix_branch_name(scan_id)
    try:
        push_branch(repo_root, scan_id, token)
        base = get_default_branch(scan.repo_url, token)
        pr = open_pull_request(
            repo_url=scan.repo_url,
            head=branch,
            base=base,
            title=f"KOVR: {len(commits)} verified security fix{'es' if len(commits) != 1 else ''}",
            body=(
                "Automated security fixes generated and verified by KOVR.\n\n"
                + "\n".join(f"- {message}" for message in reversed(commits))
                + "\n\nEach fix was re-verified against the described issue before being committed. "
                "Review and merge here on GitHub."
            ),
            token=token,
        )
    except Exception as e:
        session.close()
        return {"error": f"Could not open the pull request: {e}"}

    scan.pr_branch = branch
    scan.pr_url = pr.get("prUrl") or pr.get("pr_url") or pr.get("url")
    session.commit()
    session.close()
    # The branch is safely on GitHub now — the local archive is redundant.
    from app.core.git_ops import remove_archived_fix_branch

    remove_archived_fix_branch(scan_id)
    print(f"[pr] opened {scan.pr_url} for scan {scan_id[:8]}")
    return {"pr_url": scan.pr_url}


@router.delete("/api/scan/{scan_id}")
def delete_scan(scan_id: str, current_user: User = Depends(get_current_user)):
    """Permanently removes a scan: findings, the scan row, and the working
    copy on disk. Called when the user clears their history."""
    scan, session, error = _pr_access(scan_id, current_user)
    if error:
        return {"error": error}

    session.query(Finding).filter(Finding.scan_id == scan_id).delete(synchronize_session=False)
    session.delete(scan)
    session.commit()
    session.close()

    repo_root = f"cloned_repos/{scan_id}"
    if os.path.isdir(repo_root):
        rmtree_git_safe(repo_root)
    # Any archived fix branch goes with it — the user asked for this scan
    # to be gone.
    from app.core.git_ops import remove_archived_fix_branch

    remove_archived_fix_branch(scan_id)

    print(f"[scan] deleted {scan_id[:8]} — findings, row and working copy removed")
    return {"status": "deleted"}


@router.get("/api/scan/{scan_id}/results")
def get_scan_results(scan_id: str, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    scan = session.query(Scan).filter(Scan.id == scan_id).first()

    # Same answer for missing and not-owned scans — never confirm existence.
    if not scan or not _can_access_scan(scan, current_user):
        session.close()
        return {"error": "Scan not found"}

    # Retroactive rule: info/warning findings must never be unfixable
    # codebase-wide umbrellas. Scans saved before the severity gate get
    # normalized here, so every list shows only directly fixable findings
    # without a re-scan. High/critical umbrellas keep the on-open split.
    session.query(Finding).filter(
        Finding.scan_id == scan_id,
        Finding.scope == "codebase_wide",
        Finding.verified != "superseded",
        func.lower(Finding.severity).in_(["low", "medium", "info", "warning"]),
    ).update({"scope": "local"}, synchronize_session=False)
    session.commit()

    findings = session.query(Finding).filter(Finding.scan_id == scan_id, Finding.verified != "superseded").all()

    unresolved_for_score = [
        {"severity": f.severity} for f in findings if f.verified != "resolved"
    ]
    live_score = calculate_score(unresolved_for_score)

    result = {
        "scan_id": scan.id,
        "repo_url": scan.repo_url,
        "score": live_score,
        "findings": [
            {
                "id": f.id,
                "pillar": f.pillar,
                "tool": f.tool,
                "title": f.title,
                "file": f.file,
                "line": f.line,
                "severity": f.severity,
                "description": f.description,
                "root_cause": f.root_cause,
                "impact": f.impact,
                "verified": f.verified,
                "scope": f.scope,
                "last_verify_reason": f.last_verify_reason
            }
            for f in findings
        ]
    }
    session.close()
    return result


VALID_PILLARS = ("security", "api_design", "backend_logic", "ui_ux")


def _parse_pillars(pillars: str) -> list:
    """Comma-separated pillar selection from the client; anything invalid
    (or empty) falls back to all four — a scan must never silently run a
    partial set because of a typo."""
    selected = [p.strip() for p in (pillars or "").split(",") if p.strip() in VALID_PILLARS]
    return selected or list(VALID_PILLARS)


def run_full_scan_background(scan_id: str, repo_url: str = "unknown", user_id: str = None, pillars: list = None, resume: bool = False):
    repo_path = f"cloned_repos/{scan_id}"
    note_repo_url(scan_id, repo_url)

    if not resume:
        # Housekeeping: drop clones from finished, long-past scans so the
        # disk never fills up (this scan's own clone is excluded). A
        # resumed scan skips it — the cleanup list includes clones of
        # other interrupted scans waiting to be resumed.
        _cleanup_old_clones(exclude_scan_id=scan_id)

        # Registered by the start endpoint before the thread launched; only
        # initialize if that didn't happen (direct call, older client).
        if get_scan_progress(scan_id) is None:
            init_scan_progress(scan_id, user_id=user_id)
    else:
        # Restart recovery: progress (and any finished pillar findings)
        # was restored from disk; only the unfinished pillars re-run.
        print(f"[scan] resuming interrupted scan {scan_id[:8]}")

    # Discover and classify files ONCE, shared across pillars, instead of
    # each pillar independently re-discovering and re-scanning the same
    # files. This eliminates duplicate AI calls on files only relevant
    # to one side (e.g. a pure backend file no longer also goes to UI/UX).
    from app.core.file_router import route_files
    backend_candidates = find_relevant_files(repo_path)
    frontend_candidates = find_frontend_files(repo_path)
    routed = route_files(backend_candidates, frontend_candidates)

    def run_pillar(pillar_name, fn):
        # The deep AI call path (chat_with_retry, batch loop) reads this
        # thread-local to react to cancel/pause without scan ids threaded
        # through every scanner signature.
        set_current_scan(scan_id, pillar_name)
        update_pillar_progress(scan_id, pillar_name, {"status": "running"})
        try:
            result = fn()
            save_to_cache(f"{pillar_name}_{scan_id}", result)
            update_pillar_progress(scan_id, pillar_name, {"status": "done", "count": len(result), "source": "live", "findings": result})
        except ScanCancelledError:
            update_pillar_progress(scan_id, pillar_name, {"status": "cancelled"})
        except Exception as e:
            cached = load_from_cache(f"{pillar_name}_{scan_id}")
            if cached is not None:
                update_pillar_progress(scan_id, pillar_name, {"status": "done", "count": len(cached), "source": "cached", "findings": cached})
            else:
                update_pillar_progress(scan_id, pillar_name, {"status": "failed", "error": str(e)})
        finally:
            set_current_scan(None)

    pillar_functions = {
        "security": lambda: run_gitleaks(repo_path) + run_semgrep(repo_path),
        "api_design": lambda: run_api_design_scan(repo_path, files=routed["backend"]),
        "backend_logic": lambda: run_backend_logic_scan(repo_path, files=routed["backend"]),
        "ui_ux": lambda: run_ui_ux_scan(repo_path, files=routed["frontend"]),
    }

    # User-chosen subset: deselected pillars are marked "skipped" in the
    # progress stream and no threads are launched for them.
    if resume:
        # A resumed scan keeps its original selection: already-done and
        # skipped pillars stay untouched; only unfinished ones re-run.
        existing = get_scan_progress(scan_id) or {}
        selected = [
            name
            for name, fn in pillar_functions.items()
            if not (isinstance(existing.get(name), dict) and existing[name].get("status") in ("done", "skipped"))
        ]
    else:
        selected = [p for p in (pillars or list(VALID_PILLARS)) if p in pillar_functions]
        for pillar_name in pillar_functions:
            if pillar_name not in selected:
                update_pillar_progress(scan_id, pillar_name, {"status": "skipped"})

    threads = []
    for name in selected:
        t = threading.Thread(target=run_pillar, args=(name, pillar_functions[name]))
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    # A cancelled scan is discarded entirely — no findings row, no score,
    # no clone left on disk. The user asked for it to go away.
    if is_scan_cancelled(scan_id):
        final = get_scan_progress(scan_id) or {}
        for pillar_name in ("security", "api_design", "backend_logic", "ui_ux"):
            state = final.get(pillar_name)
            if not (isinstance(state, dict) and state.get("status") in ("done", "failed", "cancelled")):
                update_pillar_progress(scan_id, pillar_name, {"status": "cancelled"})
        rmtree_git_safe(repo_path)
        mark_scan_complete(scan_id)
        clear_scan_control(scan_id)
        return

    progress = get_scan_progress(scan_id)
    all_findings = []
    for pillar_data in progress.values():
        if isinstance(pillar_data, dict) and "findings" in pillar_data:
            all_findings.extend(pillar_data["findings"])

    score = calculate_score(all_findings)
    save_scan_results(scan_id, repo_url, all_findings, score, user_id=user_id)

    # Codebase-wide findings must never reach the UI as unfixable
    # umbrellas — split each into concrete per-file findings right away.
    # Fixes stay lazy (generated when each finding is opened, like any
    # other), so this costs one bounded pattern search per umbrella.
    try:
        session = SessionLocal()
        umbrellas = (
            session.query(Finding)
            .filter(
                Finding.scan_id == scan_id,
                Finding.scope == "codebase_wide",
                Finding.verified != "superseded",
            )
            .all()
        )
        umbrella_ids = [f.id for f in umbrellas]
        session.close()
    except Exception as e:
        print(f"[scan] WARNING: could not list codebase-wide findings: {e}")
        umbrella_ids = []

    for umbrella_id in umbrella_ids:
        try:
            expand_codebase_wide_finding(umbrella_id, with_fixes=False)
        except Exception as e:
            # Last resort: one failed umbrella must neither block the
            # others nor survive as unfixable — demote it to a single-file
            # finding so it stays directly solvable.
            print(f"[scan] WARNING: auto-split failed for {umbrella_id[:8]}: {e}")
            try:
                session = SessionLocal()
                (session.query(Finding)
                    .filter(Finding.id == umbrella_id)
                    .update({"scope": "local"}, synchronize_session=False))
                session.commit()
                session.close()
            except Exception:
                pass

    mark_scan_complete(scan_id)


def resume_interrupted_scans():
    """Called once at startup. Progress state survives restarts on disk;
    every scan that was running when the process died is either resumed
    (clone still present → only unfinished pillars re-run) or closed out
    as interrupted (clone gone → terminal state, nothing saved)."""
    for scan_id in incomplete_scan_ids():
        repo_path = f"cloned_repos/{scan_id}"
        owner_id = get_scan_owner(scan_id)
        repo_url = get_repo_url(scan_id) or "unknown"

        if os.path.isdir(repo_path) and active_scan_count() < MAX_CONCURRENT_SCANS:
            threading.Thread(
                target=run_full_scan_background,
                args=(scan_id, repo_url, owner_id, None),
                kwargs={"resume": True},
                daemon=True,
            ).start()
        else:
            # Nothing left to analyze against — close the scan out so the
            # stream reports a terminal state instead of a lost one.
            for pillar_name in ("security", "api_design", "backend_logic", "ui_ux"):
                state = (get_scan_progress(scan_id) or {}).get(pillar_name)
                if not (isinstance(state, dict) and state.get("status") in ("done", "failed", "cancelled", "skipped")):
                    update_pillar_progress(scan_id, pillar_name, {"status": "cancelled"})
            rmtree_git_safe(repo_path)
            mark_scan_complete(scan_id)
            print(f"[scan] interrupted scan {scan_id[:8]} could not be resumed — closed out")


@router.post("/api/scan/{scan_id}/start")
def start_full_scan(
    scan_id: str,
    repo_url: str = "unknown",
    pillars: str = "",
    current_user: User = Depends(get_current_user),
):
    # Concurrency cap: each scan runs 4 analyzer threads plus hundreds of AI
    # calls — a free-tier instance cannot serve several large scans at once.
    if active_scan_count() >= MAX_CONCURRENT_SCANS:
        return {
            "error": "The server is already running other scans right now — please try again in a few minutes.",
            "status": "busy",
        }
    # Register the scan BEFORE returning: the frontend opens the progress
    # stream the moment this responds, and the background thread used to
    # register it later (after disk cleanup) — losing that race made the
    # stream report "scan not found" on brand-new scans.
    init_scan_progress(scan_id, user_id=current_user.id)
    selected_pillars = _parse_pillars(pillars)
    thread = threading.Thread(
        target=run_full_scan_background,
        args=(scan_id, repo_url, current_user.id, selected_pillars),
    )
    thread.start()
    return {"scan_id": scan_id, "status": "started"}


@router.post("/api/scan/{scan_id}/cancel")
def cancel_scan(scan_id: str, current_user: User = Depends(get_current_user)):
    """Cooperative abort: the scan stops at the next safe point (between AI
    calls/batches), nothing is saved, and the clone is removed."""
    owner_id = get_scan_owner(scan_id)
    if owner_id is not None and current_user.role != "admin" and owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scan not found")
    if get_scan_progress(scan_id) is None:
        return {"error": "Scan not found"}
    request_scan_cancel(scan_id)
    return {"status": "cancelling"}


@router.post("/api/scan/{scan_id}/pause")
def pause_scan(scan_id: str, current_user: User = Depends(get_current_user)):
    owner_id = get_scan_owner(scan_id)
    if owner_id is not None and current_user.role != "admin" and owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scan not found")
    if get_scan_progress(scan_id) is None:
        return {"error": "Scan not found"}
    set_scan_paused(scan_id, True)
    return {"status": "paused"}


@router.post("/api/scan/{scan_id}/resume")
def resume_scan(scan_id: str, current_user: User = Depends(get_current_user)):
    owner_id = get_scan_owner(scan_id)
    if owner_id is not None and current_user.role != "admin" and owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scan not found")
    if get_scan_progress(scan_id) is None:
        return {"error": "Scan not found"}
    set_scan_paused(scan_id, False)
    return {"status": "resumed"}


# How long the stream waits for a just-started scan to register before
# declaring it missing — covers slow thread scheduling under load.
SCAN_REGISTER_GRACE_S = 5.0


@router.get("/api/scan/{scan_id}/stream")
def stream_scan_progress(scan_id: str, current_user: User = Depends(get_current_user)):
    # In-progress scans have no DB row yet — ownership comes from the
    # in-memory owner map. Unknown owner (e.g. after a restart) falls
    # through and serves the standard "scan not found" progress below.
    owner_id = get_scan_owner(scan_id)
    if owner_id is not None and current_user.role != "admin" and owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scan not found")

    def event_generator():
        # A just-started scan may not be registered for a moment under
        # load — hold the stream open briefly instead of erroring into a
        # race that reports a brand-new scan as missing.
        deadline = time.time() + SCAN_REGISTER_GRACE_S
        while True:
            progress = get_scan_progress(scan_id)
            if progress is None:
                if time.time() < deadline:
                    yield ": waiting\n\n"
                    time.sleep(0.5)
                    continue
                yield f"data: {json.dumps({'error': 'scan not found'})}\n\n"
                break

            yield f"data: {json.dumps(progress)}\n\n"

            if progress.get("complete"):
                break

            time.sleep(1)

    return StreamingResponse(event_generator(), media_type="text/event-stream")