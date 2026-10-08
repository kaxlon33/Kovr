"""
Tiny in-memory sliding-window rate limiter for the auth endpoints.

Deliberately dependency-free (no Redis, no slowapi) and thread-safe: FastAPI
runs sync endpoints in a threadpool, so the buckets are guarded by a lock and
periodically pruned so an IP churn cannot grow the map without bound.

SINGLE-INSTANCE ONLY by design: each process keeps its own counters, so the
limits effectively multiply if the backend is ever scaled horizontally.
Swap this module for a Redis-backed implementation before running more than
one instance (see the auth router for the call sites).
"""
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable, Awaitable

from fastapi import HTTPException, Request

_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_LOCK = threading.Lock()

# Prune thresholds: past this many keys, expired buckets are dropped.
_PRUNE_AT_KEYS = 10_000


def _client_ip(request: Request) -> str:
    # Behind Render's proxy the socket peer is the proxy; the real client
    # arrives in the forwarded headers.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune_expired_locked(now: float, window_seconds: int) -> None:
    """Caller must hold _LOCK. Drops buckets with no recent hits."""
    stale = [
        key
        for key, bucket in _BUCKETS.items()
        if not bucket or now - bucket[-1] > window_seconds
    ]
    for key in stale:
        del _BUCKETS[key]


def rate_limit(scope: str, max_hits: int, window_seconds: int) -> Callable[[Request], Awaitable[None]]:
    """FastAPI dependency: at most `max_hits` requests per IP per window."""

    async def dependency(request: Request) -> None:
        key = f"{scope}:{_client_ip(request)}"
        now = time.monotonic()
        with _LOCK:
            if len(_BUCKETS) > _PRUNE_AT_KEYS:
                _prune_expired_locked(now, window_seconds)

            bucket = _BUCKETS[key]
            while bucket and now - bucket[0] > window_seconds:
                bucket.popleft()
            if len(bucket) >= max_hits:
                raise HTTPException(
                    status_code=429,
                    detail="Too many attempts — wait a moment and try again.",
                )
            bucket.append(now)

    return dependency
