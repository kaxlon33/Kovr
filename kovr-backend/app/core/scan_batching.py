# LLM-based pillars (API Design, Backend Logic, UI/UX) have no dedicated
# static-analysis tool — every file is analyzed via an API call. Provider
# rate limits and per-call latency make scanning an unbounded number of
# files in one pass impractical, so files are processed in batches instead
# of being arbitrarily truncated.
from app.core.ai_client import get_current_scan, ScanCancelledError
from app.core.progress import is_scan_cancelled

BATCH_SIZE = 5


def prioritize_files(file_paths: list, keywords: list = None) -> list:
    """
    Rank files so the most relevant ones are scanned in earlier batches.
    Heuristic: keyword relevance to the pillar's domain, then file size
    (smaller files are cheaper/faster to analyze).
    """
    keywords = keywords or []

    def score(path):
        name = path.replace("\\", "/").lower()
        relevance = sum(1 for kw in keywords if kw.lower() in name)
        return (-relevance, len(path))

    return sorted(file_paths, key=score)


def make_batches(file_paths: list, batch_size: int = BATCH_SIZE) -> list:
    """Split a prioritized file list into fixed-size batches."""
    return [file_paths[i:i + batch_size] for i in range(0, len(file_paths), batch_size)]


def run_batched_scan(files: list, keywords: list, scan_batch_fn, batch_size: int = BATCH_SIZE) -> list:
    ranked = prioritize_files(files, keywords)
    batches = make_batches(ranked, batch_size)

    print(f"Total files found: {len(files)} | Split into {len(batches)} batches of {batch_size}")

    # The pillar thread set which scan it is working on; the batch-level
    # cancel check hangs off that context.
    scan_id, _pillar = get_current_scan()

    all_findings = []
    for i, batch in enumerate(batches):
        if scan_id and is_scan_cancelled(scan_id):
            raise ScanCancelledError(f"scan {scan_id} cancelled by user")
        print(f"Scanning batch {i+1}/{len(batches)}: {batch}")
        try:
            all_findings.extend(scan_batch_fn(batch))
        except ScanCancelledError:
            raise
        except Exception as e:
            # One bad batch must never zero out the whole pillar — the
            # run stays complete, so the score stays comparable across
            # scans of the same repo.
            print(f"[batch] batch {i+1} failed ({e}) — continuing with the next batch")

    return all_findings
