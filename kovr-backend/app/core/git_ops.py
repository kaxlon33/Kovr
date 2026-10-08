"""
Git operations on the scanned clone for the PR lifecycle.

Approved+verified fixes are committed one by one to a dedicated branch
(kovr/fix-{scan_id}) inside the cloned repository. Nothing is pushed
anywhere until the user explicitly opens a pull request.

Before a working copy is cleaned up, an unpushed fix branch is archived
into a self-contained git bundle — verified fixes must not die with the
clone's retention window.
"""
import json
import os
import stat

import git

FIX_AUTHOR_NAME = "KOVR Security Scanner"
FIX_AUTHOR_EMAIL = "kovr-scanner@localhost"

BUNDLE_DIR = os.path.join("cache_data", "pr_bundles")


def rmtree(path: str) -> None:
    """Windows-safe directory removal. Git marks its object files
    read-only, which makes plain shutil.rmtree(ignore_errors=True) fail
    SILENTLY and leave half-deleted clones behind."""
    import shutil

    def relax(func, p, _exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass

    shutil.rmtree(path, ignore_errors=False, onerror=relax)
    shutil.rmtree(path, ignore_errors=True)


def bundle_paths(scan_id: str):
    """(bundle file, sidecar json) for a scan's archived fix branch."""
    base = os.path.join(BUNDLE_DIR, scan_id)
    return f"{base}.bundle", f"{base}.json"


def fix_branch_name(scan_id: str) -> str:
    return f"kovr/fix-{scan_id[:8]}"


def _repo(repo_path: str) -> git.Repo:
    return git.Repo(repo_path)


def _ensure_identity(repo: git.Repo) -> None:
    """Commits need an author; set a local identity only where missing so
    the developer's global git config is never touched."""
    try:
        if not repo.config_reader().get_value("user", "email", ""):
            with repo.config_writer() as cw:
                cw.set_value("user", "name", FIX_AUTHOR_NAME)
                cw.set_value("user", "email", FIX_AUTHOR_EMAIL)
    except Exception:
        with repo.config_writer() as cw:
            cw.set_value("user", "name", FIX_AUTHOR_NAME)
            cw.set_value("user", "email", FIX_AUTHOR_EMAIL)


def base_commit(repo_path: str) -> str:
    """The original clone snapshot (single root commit of the shallow
    clone) — the diff base for 'what did KOVR change'."""
    repo = _repo(repo_path)
    return repo.git.rev_list("--max-parents=0", "HEAD").strip().splitlines()[-1]


def ensure_fix_branch(repo_path: str, scan_id: str) -> str:
    """Create/switch to the fix branch, carrying any working-tree fixes."""
    repo = _repo(repo_path)
    name = fix_branch_name(scan_id)
    existing = [h.name for h in repo.heads]
    if name in existing:
        repo.git.checkout(name)
    else:
        repo.git.checkout("-b", name)
    return name


def has_commit_for(repo_path: str, finding_id: str) -> bool:
    """Idempotency: one commit per finding, even if verify runs twice."""
    try:
        repo = _repo(repo_path)
        out = repo.git.log(f"--grep={finding_id}", "--oneline", "-1")
        return bool(out.strip())
    except Exception:
        return False


def commit_finding_fix(repo_path: str, scan_id: str, rel_file_path: str, finding_id: str, title: str) -> bool:
    """Commit one verified finding's file to the fix branch."""
    repo = _repo(repo_path)
    ensure_fix_branch(repo_path, scan_id)
    _ensure_identity(repo)
    if has_commit_for(repo_path, finding_id):
        return False
    repo.git.add(rel_file_path)
    repo.index.commit(
        f"fix(kovr): {title}\n\nAutomated fix for finding {finding_id}, verified by KOVR before commit."
    )
    return True


def branch_commit_messages(repo_path: str, scan_id: str) -> list:
    """Commit subjects on the fix branch, newest first."""
    name = fix_branch_name(scan_id)
    try:
        repo = _repo(repo_path)
        if name not in [h.name for h in repo.heads]:
            return []
        out = repo.git.log(name, "--pretty=format:%s", f"{base_commit(repo_path)}..{name}")
        return [line for line in out.splitlines() if line.strip()]
    except Exception:
        return []


def changed_files(repo_path: str) -> list:
    """Files KOVR modified, relative to the original clone snapshot."""
    try:
        repo = _repo(repo_path)
        out = repo.git.diff("--name-only", base_commit(repo_path), "HEAD")
        return [line.strip() for line in out.splitlines() if line.strip()]
    except Exception:
        return []


def owner_repo_from_url(repo_url: str):
    """('owner', 'repo') from a github URL, or None."""
    import re

    match = re.search(r"github\.com[/:]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$", repo_url or "")
    return (match.group(1), match.group(2)) if match else None


def push_branch(repo_path: str, scan_id: str, token: str) -> None:
    """Push the fix branch to the repository's GitHub origin."""
    repo = _repo(repo_path)
    origin_url = next((r.url for r in repo.remotes if r.name == "origin"), None)
    if not origin_url:
        raise RuntimeError("The cloned repository has no origin remote.")
    owner_repo = owner_repo_from_url(origin_url)
    if not owner_repo:
        raise RuntimeError(f"Cannot determine the GitHub repository from {origin_url}")
    branch = fix_branch_name(scan_id)
    authed_url = f"https://x-access-token:{token}@github.com/{owner_repo[0]}/{owner_repo[1]}.git"
    # Push via an explicit URL — the stored origin is never rewritten.
    repo.git.push(authed_url, f"refs/heads/{branch}:refs/heads/{branch}")


# ── fix-branch archival ──────────────────────────────────────────────────


def archive_fix_branch(repo_path: str, scan_id: str) -> bool:
    """Preserve an unpushed fix branch before its clone is cleaned up.

    Writes the branch (with full history, self-contained) to a git bundle
    plus a small JSON sidecar carrying the branch name, commit subjects and
    the origin URL. Returns True when there was something worth keeping."""
    try:
        messages = branch_commit_messages(repo_path, scan_id)
        if not messages:
            return False
        repo = _repo(repo_path)
        origin_url = next((r.url for r in repo.remotes if r.name == "origin"), None)
        if not origin_url:
            return False
        branch = fix_branch_name(scan_id)
        os.makedirs(BUNDLE_DIR, exist_ok=True)
        bundle_file, sidecar = bundle_paths(scan_id)
        # Absolute: git resolves relative paths against the repo's own
        # working directory, not the server's cwd.
        repo.git.bundle("create", os.path.abspath(bundle_file), f"refs/heads/{branch}")
        with open(sidecar, "w", encoding="utf-8") as fh:
            json.dump(
                {"branch": branch, "commit_messages": messages, "origin_url": origin_url},
                fh,
            )
        print(f"[pr] archived {len(messages)} unpushed fix commit(s) for scan {scan_id[:8]}")
        return True
    except Exception as e:
        print(f"[pr] WARNING: could not archive fix branch for {scan_id[:8]}: {e}")
        return False


def archived_fix_branch(scan_id: str):
    """Sidecar record for an archived fix branch, or None."""
    _bundle_file, sidecar = bundle_paths(scan_id)
    if not os.path.exists(sidecar):
        return None
    try:
        with open(sidecar, encoding="utf-8") as fh:
            record = json.load(fh)
        return record if record.get("commit_messages") else None
    except Exception:
        return None


def restore_fix_branch(scan_id: str):
    """Rebuild cloned_repos/<scan_id> from the archived bundle so the
    normal push/PR flow works after the working copy was cleaned up.
    Returns the repo path, or None when nothing is archived."""
    bundle_file, _sidecar = bundle_paths(scan_id)
    record = archived_fix_branch(scan_id)
    if not os.path.exists(bundle_file) or not record:
        return None
    repo_root = f"cloned_repos/{scan_id}"
    if os.path.exists(repo_root):
        # Leftovers from an earlier restore attempt would block the clone.
        rmtree(repo_root)
    try:
        repo = git.Repo.clone_from(bundle_file, repo_root)
        branch = record.get("branch") or fix_branch_name(scan_id)
        try:
            repo.git.checkout(branch)
        except Exception:
            repo.git.checkout("-B", branch, f"refs/remotes/origin/{branch}")
        # The clone's origin points at the bundle file — repoint it at the
        # real GitHub repository so push_branch derives the right target.
        origin_url = record.get("origin_url")
        if origin_url:
            origin = next((r for r in repo.remotes if r.name == "origin"), None)
            if origin is None:
                repo.create_remote("origin", origin_url)
            elif origin.url != origin_url:
                repo.delete_remote(origin)
                repo.create_remote("origin", origin_url)
        print(f"[pr] restored archived fix branch for scan {scan_id[:8]}")
        return repo_root
    except Exception as e:
        print(f"[pr] could not restore archived branch for {scan_id[:8]}: {e}")
        rmtree(repo_root)
        return None


def remove_archived_fix_branch(scan_id: str) -> None:
    """Drop a scan's bundle + sidecar (history deleted or PR opened)."""
    for path in bundle_paths(scan_id):
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError:
            pass
