"""
Minimal GitHub REST client for the PR lifecycle — dependency-free
(urllib), because the whole integration needs exactly two calls:
look up the repository's default branch, and open a pull request.
"""
import json
import os
import urllib.error
import urllib.request

from app.core.git_ops import owner_repo_from_url


def github_token() -> str:
    return os.getenv("GITHUB_TOKEN", "").strip()


def _request(url: str, token: str, data: dict = None) -> dict:
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            **({"Content-Type": "application/json"} if body else {}),
        },
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def get_default_branch(repo_url: str, token: str) -> str:
    owner_repo = owner_repo_from_url(repo_url)
    if not owner_repo:
        raise RuntimeError(f"Not a GitHub repository URL: {repo_url}")
    data = _request(f"https://api.github.com/repos/{owner_repo[0]}/{owner_repo[1]}", token)
    return data.get("default_branch") or "main"


def open_pull_request(repo_url: str, head: str, base: str, title: str, body: str, token: str) -> dict:
    """Opens a PR; if one already exists for this branch, returns it."""
    owner_repo = owner_repo_from_url(repo_url)
    if not owner_repo:
        raise RuntimeError(f"Not a GitHub repository URL: {repo_url}")
    api = f"https://api.github.com/repos/{owner_repo[0]}/{owner_repo[1]}/pulls"
    try:
        data = _request(api, token, {"title": title, "head": head, "base": base, "body": body})
        return {"pr_url": data.get("html_url"), "number": data.get("number")}
    except urllib.error.HTTPError as e:
        if e.code == 422:
            # "A pull request already exists" — return the existing one.
            existing = _request(f"{api}?head={owner_repo[0]}:{head}&state=open", token)
            if existing:
                return {"pr_url": existing[0].get("html_url"), "number": existing[0].get("number")}
        detail = ""
        try:
            detail = e.read().decode()[:300]
        except Exception:
            pass
        raise RuntimeError(f"GitHub refused the pull request ({e.code}): {detail}") from e
