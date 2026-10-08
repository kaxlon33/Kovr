import json
import os
import threading

_progress_store = {}
_owner_store = {}  # scan_id -> user_id of the user who started the scan
_repo_url_store = {}  # scan_id -> repository URL, for restart resume
_cancel_requests = set()  # scan_ids the user asked to abort
_pause_flags = set()  # scan_ids currently held at a safe point
_lock = threading.Lock()

# Completed entries are kept briefly (stream reconnects after completion)
# but pruned so the in-memory store cannot grow without bound.
MAX_COMPLETED_ENTRIES = 50

# The whole store is mirrored to disk so a backend restart can resume
# interrupted scans instead of losing them entirely.
_STORE_PATH = os.path.join("cache_data", "progress_store.json")


def _persist_locked():
    """Caller must hold _lock. Best-effort mirror to disk."""
    try:
        os.makedirs(os.path.dirname(_STORE_PATH), exist_ok=True)
        with open(_STORE_PATH, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "progress": _progress_store,
                    "owners": _owner_store,
                    "repo_urls": _repo_url_store,
                    "cancelled": sorted(_cancel_requests),
                    "paused": sorted(_pause_flags),
                },
                fh,
            )
    except Exception as e:
        print(f"[progress] WARNING: could not persist state: {e}")


def _load_store():
    """Restore state after a restart. Incomplete scans come back as-is so
    the resume routine can decide what to do with them."""
    try:
        with open(_STORE_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        _progress_store.update(data.get("progress", {}))
        _owner_store.update(data.get("owners", {}))
        _repo_url_store.update(data.get("repo_urls", {}))
        for scan_id in data.get("cancelled", []):
            _cancel_requests.add(scan_id)
        for scan_id in data.get("paused", []):
            _pause_flags.add(scan_id)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[progress] WARNING: could not restore state: {e}")


_load_store()


def init_scan_progress(scan_id: str, user_id: str = None):
    with _lock:
        _progress_store[scan_id] = {
            "security": {"status": "pending"},
            "api_design": {"status": "pending"},
            "backend_logic": {"status": "pending"},
            "ui_ux": {"status": "pending"},
            "complete": False
        }
        if user_id:
            _owner_store[scan_id] = user_id
        _persist_locked()


def note_repo_url(scan_id: str, repo_url: str):
    with _lock:
        _repo_url_store[scan_id] = repo_url
        _persist_locked()


def get_repo_url(scan_id: str):
    with _lock:
        return _repo_url_store.get(scan_id)


def incomplete_scan_ids() -> list:
    """Scan ids that were running when the process died, oldest first."""
    with _lock:
        return [
            scan_id
            for scan_id, progress in _progress_store.items()
            if isinstance(progress, dict) and not progress.get("complete")
        ]


def get_scan_owner(scan_id: str):
    with _lock:
        return _owner_store.get(scan_id)


def update_pillar_progress(scan_id: str, pillar: str, status_data: dict):
    with _lock:
        if scan_id in _progress_store:
            _progress_store[scan_id][pillar] = status_data
            _persist_locked()


def mark_scan_complete(scan_id: str):
    with _lock:
        if scan_id in _progress_store:
            _progress_store[scan_id]["complete"] = True
        _prune_completed_locked()
        _persist_locked()


# ── user-initiated scan control ───────────────────────────────────────────
# Cooperative: the flags are checked at safe points (between AI calls,
# between batches) so aborting never leaves a tool run or DB write half-done.


def request_scan_cancel(scan_id: str):
    with _lock:
        _cancel_requests.add(scan_id)


def is_scan_cancelled(scan_id: str) -> bool:
    with _lock:
        return scan_id in _cancel_requests


def set_scan_paused(scan_id: str, paused: bool):
    with _lock:
        if paused:
            _pause_flags.add(scan_id)
        else:
            _pause_flags.discard(scan_id)


def is_scan_paused(scan_id: str) -> bool:
    with _lock:
        return scan_id in _pause_flags


def clear_scan_control(scan_id: str):
    with _lock:
        _cancel_requests.discard(scan_id)
        _pause_flags.discard(scan_id)
        _persist_locked()


def get_scan_progress(scan_id: str):
    with _lock:
        progress = _progress_store.get(scan_id)
        if progress is None:
            return None
        # Control state rides along on every frame so the UI can show
        # paused/cancelled without a second endpoint.
        data = dict(progress)
        data["paused"] = scan_id in _pause_flags
        data["cancelled"] = scan_id in _cancel_requests
        return data


def active_scan_count() -> int:
    """How many scans are currently running — the concurrency cap reads this."""
    with _lock:
        return sum(
            1
            for progress in _progress_store.values()
            if isinstance(progress, dict) and not progress.get("complete")
        )


def _prune_completed_locked():
    """Caller must hold _lock. Drops the oldest completed entries beyond
    MAX_COMPLETED_ENTRIES, along with their owner and control records."""
    completed = [
        scan_id
        for scan_id, progress in _progress_store.items()
        if isinstance(progress, dict) and progress.get("complete")
    ]
    # Dicts preserve insertion order, so the first entries are the oldest.
    for scan_id in completed[: max(0, len(completed) - MAX_COMPLETED_ENTRIES)]:
        _progress_store.pop(scan_id, None)
        _owner_store.pop(scan_id, None)
        _repo_url_store.pop(scan_id, None)
        _cancel_requests.discard(scan_id)
        _pause_flags.discard(scan_id)
