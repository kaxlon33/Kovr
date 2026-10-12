from sentence_transformers import SentenceTransformer

_model = None


def _get_model() -> SentenceTransformer:
    """Lazy-load on first use. Loading at import time costs ~400MB of RAM
    on boot, which OOM-kills the app on small free-tier instances before
    the health check can ever answer."""
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")  # 384-dim vectors
    return _model


def generate_embedding(text: str):
    if not text:
        return None
    vector = _get_model().encode(text)
    return vector.tolist()
