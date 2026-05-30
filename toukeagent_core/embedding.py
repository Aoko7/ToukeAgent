from __future__ import annotations

import hashlib
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-base"
DEFAULT_FALLBACK_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
MODEL_DIMENSIONS = {
    "intfloat/multilingual-e5-base": 768,
    "intfloat/multilingual-e5-small": 384,
    "BAAI/bge-m3": 1024,
}
EMBEDDING_MODEL_PATHS = {
    "intfloat/multilingual-e5-base": Path(__file__).resolve().parents[1] / "data" / "models" / "embeddings" / "multilingual-e5-base",
    "intfloat/multilingual-e5-small": Path(__file__).resolve().parents[1] / "data" / "models" / "embeddings" / "multilingual-e5-small",
    "BAAI/bge-m3": Path(__file__).resolve().parents[1] / "data" / "models" / "embeddings" / "bge-m3",
}


def _default_dim_for_model(model_name: str) -> int:
    return MODEL_DIMENSIONS.get(model_name, 384)


def _resolve_model_source(model_name: str) -> str:
    override_root = os.environ.get("TOUKEAGENT_EMBEDDING_MODEL_ROOT")
    if override_root:
        candidate = Path(override_root).expanduser() / model_name.split("/")[-1]
        if candidate.exists():
            return str(candidate)
    candidate = EMBEDDING_MODEL_PATHS.get(model_name)
    if candidate and candidate.exists():
        return str(candidate)
    return model_name


def _normalize(values: list[float]) -> list[float]:
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude <= 0:
        return values
    return [value / magnitude for value in values]


def _prefixed_text(text: str, input_type: str) -> str:
    normalized = str(text or "").strip()
    if input_type == "query":
        return f"query: {normalized}"
    return f"passage: {normalized}"


@dataclass(slots=True)
class EmbeddingBatch:
    vectors: list[list[float]]
    model_name: str
    dimensions: int
    backend: str
    input_type: str
    normalized: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "dimensions": self.dimensions,
            "backend": self.backend,
            "input_type": self.input_type,
            "normalized": self.normalized,
            "vector_count": len(self.vectors),
            "vectors": self.vectors,
        }


class BaseEmbedder:
    model_name: str
    dimensions: int
    backend: str

    def encode(self, texts: list[str], *, input_type: str = "passage") -> EmbeddingBatch:  # pragma: no cover - abstract
        raise NotImplementedError

    def describe(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "dimensions": self.dimensions,
            "backend": self.backend,
        }


class DeterministicHashEmbedder(BaseEmbedder):
    def __init__(self, model_name: str = DEFAULT_FALLBACK_EMBEDDING_MODEL, dimensions: int | None = None) -> None:
        self.model_name = model_name
        self.dimensions = dimensions or _default_dim_for_model(model_name)
        self.backend = "deterministic_hash"

    def _encode_one(self, text: str, input_type: str) -> list[float]:
        values: list[float] = []
        seed = _prefixed_text(text, input_type)
        cursor = 0
        while len(values) < self.dimensions:
            digest = hashlib.sha256(f"{seed}:{cursor}".encode("utf-8")).digest()
            for offset in range(0, len(digest), 4):
                chunk = digest[offset : offset + 4]
                integer = int.from_bytes(chunk, byteorder="big", signed=False)
                scaled = (integer / 4294967295.0) * 2.0 - 1.0
                values.append(scaled)
                if len(values) >= self.dimensions:
                    break
            cursor += 1
        return _normalize(values)

    def encode(self, texts: list[str], *, input_type: str = "passage") -> EmbeddingBatch:
        vectors = [self._encode_one(text, input_type) for text in texts]
        return EmbeddingBatch(
            vectors=vectors,
            model_name=self.model_name,
            dimensions=self.dimensions,
            backend=self.backend,
            input_type=input_type,
        )


class SentenceTransformersEmbedder(BaseEmbedder):
    def __init__(self, model_name: str = DEFAULT_EMBEDDING_MODEL, dimensions: int | None = None) -> None:
        os.environ.setdefault("USE_TORCH", "1")
        os.environ.setdefault("USE_TF", "0")
        os.environ.setdefault("MPLCONFIGDIR", tempfile.mkdtemp(prefix="toukeagent-mpl-"))
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self.dimensions = dimensions or _default_dim_for_model(model_name)
        self.backend = "sentence_transformers"
        self._model_source = _resolve_model_source(model_name)
        self._model = SentenceTransformer(self._model_source)

    def encode(self, texts: list[str], *, input_type: str = "passage") -> EmbeddingBatch:
        encoded = self._model.encode(
            [_prefixed_text(text, input_type) for text in texts],
            normalize_embeddings=True,
        )
        vectors = [list(map(float, row)) for row in encoded]
        dimensions = len(vectors[0]) if vectors else self.dimensions
        return EmbeddingBatch(
            vectors=vectors,
            model_name=self.model_name,
            dimensions=dimensions,
            backend=self.backend,
            input_type=input_type,
        )


def sentence_transformers_available() -> bool:
    try:
        os.environ.setdefault("USE_TORCH", "1")
        os.environ.setdefault("USE_TF", "0")
        os.environ.setdefault("MPLCONFIGDIR", tempfile.mkdtemp(prefix="toukeagent-mpl-"))
        import sentence_transformers  # noqa: F401
    except Exception:
        return False
    return True


def create_embedder(config: dict[str, Any] | None = None) -> BaseEmbedder:
    config = config or {}
    primary_model = str(config.get("primary_model") or DEFAULT_EMBEDDING_MODEL)
    fallback_model = str(config.get("fallback_model") or DEFAULT_FALLBACK_EMBEDDING_MODEL)
    force_backend = config.get("force_backend")

    if force_backend == "deterministic_hash":
        return DeterministicHashEmbedder(fallback_model)

    if sentence_transformers_available():
        try:
            return SentenceTransformersEmbedder(primary_model)
        except Exception:
            return DeterministicHashEmbedder(fallback_model)

    return DeterministicHashEmbedder(fallback_model)


def describe_embedding_strategy(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    primary_model = str(config.get("primary_model") or DEFAULT_EMBEDDING_MODEL)
    fallback_model = str(config.get("fallback_model") or DEFAULT_FALLBACK_EMBEDDING_MODEL)
    embedder = create_embedder(config)
    return {
        "space_mode": "single_multilingual",
        "same_space_required": True,
        "primary_model": primary_model,
        "fallback_model": fallback_model,
        "active_model": embedder.model_name,
        "dimensions": embedder.dimensions,
        "backend": embedder.backend,
        "model_source": _resolve_model_source(embedder.model_name),
        "dependencies": {
            "sentence_transformers": sentence_transformers_available(),
        },
        "upgrade_path": "BAAI/bge-m3",
    }


def embed_texts(payload: dict[str, Any]) -> dict[str, Any]:
    texts = [str(item) for item in (payload.get("texts") or [])]
    input_type = str(payload.get("input_type") or "passage")
    config = dict(payload.get("config") or {})
    embedder = create_embedder(config)
    batch = embedder.encode(texts, input_type=input_type)
    strategy = describe_embedding_strategy(config)
    return {
        **batch.as_dict(),
        "strategy": strategy,
    }
