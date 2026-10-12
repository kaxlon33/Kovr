import os

_model = None


def embeddings_enabled() -> bool:
    """KOVR_EMBEDDINGS=off disables the feature entirely (free-tier
    deploys without the RAM for torch). Similar-findings search quietly
    returns nothing; everything else works unchanged."""
    return os.getenv("KOVR_EMBEDDINGS", "on").strip().lower() not in (
        "0",
        "false",
        "off",
        "no",
    )


def _get_model():
    """Lazy-load model AND heavy imports. `from sentence_transformers ...`
    pulls in all of torch (~400MB RSS) — doing it at module import time
    OOM-kills the app on small free-tier instances before the port even
    opens."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer("all-MiniLM-L6-v2")  # 384-dim vectors
    return _model


def generate_embedding(text: str):
    if not text or not embeddings_enabled():
        return None
    vector = _get_model().encode(text)
    return vector.tolist()
