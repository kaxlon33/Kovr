from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")  # outputs 384-dim vectors

def generate_embedding(text: str):
    if not text:
        return None
    vector = model.encode(text)
    return vector.tolist()