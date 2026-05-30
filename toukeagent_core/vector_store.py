from __future__ import annotations

from pathlib import Path
from typing import Any
from math import sqrt


DEFAULT_QDRANT_PATH = Path(__file__).resolve().parents[1] / "data" / "qdrant"
DEFAULT_COLLECTION_NAME = "toukeagent-rag"


def qdrant_client_available() -> bool:
    try:
        import qdrant_client  # noqa: F401
    except Exception:
        return False
    return True


def _match_payload(payload: dict[str, Any], filters: dict[str, Any]) -> bool:
    if not filters:
        return True
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    for key, expected in filters.items():
        actual = payload.get(key)
        if actual is None and metadata:
            actual = metadata.get(key)
        if isinstance(expected, list):
            if isinstance(actual, list):
                if not any(value in expected for value in actual):
                    return False
            elif actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def _build_query_filter(filters: dict[str, Any]) -> Any | None:
    if not filters:
        return None

    from qdrant_client.http.models import FieldCondition, Filter, MatchAny, MatchValue

    conditions: list[Any] = []
    for key, expected in filters.items():
        if expected is None:
            continue

        field_conditions: list[Any] = []
        keys_to_check = [key]
        if key != "metadata" and not key.startswith("metadata."):
            keys_to_check.append(f"metadata.{key}")

        for field_key in keys_to_check:
            if isinstance(expected, list):
                normalized = [value for value in expected if isinstance(value, (str, int))]
                if not normalized:
                    continue
                field_conditions.append(FieldCondition(key=field_key, match=MatchAny(any=normalized)))
            elif isinstance(expected, (str, int, bool)):
                field_conditions.append(FieldCondition(key=field_key, match=MatchValue(value=expected)))

        if not field_conditions:
            continue
        if len(field_conditions) == 1:
            conditions.append(field_conditions[0])
        else:
            conditions.append(Filter(should=field_conditions))

    if not conditions:
        return None
    return Filter(must=conditions)


def _normalize_vector(values: list[float]) -> list[float]:
    magnitude = sqrt(sum(value * value for value in values))
    if magnitude <= 0:
        return list(values)
    return [value / magnitude for value in values]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    return float(sum(left[index] * right[index] for index in range(size)))


class QdrantLocalStore:
    def __init__(
        self,
        *,
        path: str | Path | None = None,
        collection_name: str = DEFAULT_COLLECTION_NAME,
        vector_size: int = 768,
    ) -> None:
        self.path = Path(path or DEFAULT_QDRANT_PATH)
        self.collection_name = collection_name
        self.vector_size = vector_size
        self._fallback_points: list[dict[str, Any]] = []
        self._client = None
        if qdrant_client_available():
            from qdrant_client import QdrantClient

            self.path.mkdir(parents=True, exist_ok=True)
            self._client = QdrantClient(path=str(self.path))

    def available(self) -> bool:
        return self._client is not None

    def close(self) -> None:
        if self._client is not None and hasattr(self._client, "close"):
            self._client.close()

    def describe(self) -> dict[str, Any]:
        return {
            "kind": "qdrant_local",
            "collection_name": self.collection_name,
            "path": str(self.path),
            "vector_size": self.vector_size,
            "available": self.available(),
            "dependency": "qdrant_client",
            "mode": "local_mode" if self.available() else "stub",
        }

    def ensure_collection(self) -> dict[str, Any]:
        if not self.available():
            return {
                **self.describe(),
                "created": False,
                "reason": "qdrant_client_missing",
            }

        from qdrant_client.models import Distance, VectorParams

        assert self._client is not None
        exists = self._client.collection_exists(self.collection_name)
        if not exists:
            self._client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=self.vector_size, distance=Distance.COSINE),
            )
        return {
            **self.describe(),
            "created": not exists,
        }

    def upsert_points(self, points: list[dict[str, Any]]) -> dict[str, Any]:
        if not self.available():
            for point in points:
                payload = dict(point.get("payload") or {})
                self._fallback_points = [item for item in self._fallback_points if item.get("id") != point["id"]]
                self._fallback_points.append(
                    {
                        "id": point["id"],
                        "vector": _normalize_vector(list(point["vector"])),
                        "payload": payload,
                    }
                )
            return {
                **self.describe(),
                "upserted": len(points),
            }

        from qdrant_client.models import PointStruct

        assert self._client is not None
        self.ensure_collection()
        structs = [
            PointStruct(
                id=point["id"],
                vector=point["vector"],
                payload=point.get("payload") or {},
            )
            for point in points
        ]
        self._client.upsert(collection_name=self.collection_name, points=structs)
        return {
            **self.describe(),
            "upserted": len(points),
        }

    def search(self, query_vector: list[float], *, limit: int = 5, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        filters = filters or {}
        if not self.available():
            normalized_query = _normalize_vector(list(query_vector))
            matched = [
                {
                    "id": point["id"],
                    "score": _cosine_similarity(normalized_query, point.get("vector") or []),
                    "payload": point.get("payload") or {},
                }
                for point in self._fallback_points
                if _match_payload(point.get("payload") or {}, filters)
            ]
            matched.sort(key=lambda item: item.get("score", 0), reverse=True)
            return matched[:limit]

        # Real filtered search is intentionally deferred until qdrant-client is installed.
        assert self._client is not None
        response = self._client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            query_filter=_build_query_filter(filters),
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        hits = response.points
        results: list[dict[str, Any]] = []
        for hit in hits:
            payload = dict(hit.payload or {})
            if filters and not _match_payload(payload, filters):
                continue
            results.append(
                {
                    "id": hit.id,
                    "score": float(hit.score),
                    "payload": payload,
                }
            )
        return results[:limit]

    def iter_payloads(self, *, filters: dict[str, Any] | None = None, limit: int = 10000) -> list[dict[str, Any]]:
        filters = filters or {}
        if not self.available():
            return [
                {
                    "id": point["id"],
                    "payload": point.get("payload") or {},
                }
                for point in self._fallback_points
                if _match_payload(point.get("payload") or {}, filters)
            ][:limit]

        assert self._client is not None
        records, _ = self._client.scroll(
            collection_name=self.collection_name,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        items: list[dict[str, Any]] = []
        for record in records:
            payload = dict(record.payload or {})
            if filters and not _match_payload(payload, filters):
                continue
            items.append(
                {
                    "id": record.id,
                    "payload": payload,
                }
            )
        return items


def describe_vector_backend(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    available = qdrant_client_available()
    return {
        "kind": "qdrant_local",
        "collection_name": str(config.get("collection_name") or DEFAULT_COLLECTION_NAME),
        "path": str(config.get("path") or DEFAULT_QDRANT_PATH),
        "vector_size": int(config.get("vector_size") or 768),
        "available": available,
        "dependency": "qdrant_client",
        "mode": "local_mode" if available else "stub",
    }


def create_vector_store(config: dict[str, Any] | None = None) -> QdrantLocalStore:
    config = config or {}
    return QdrantLocalStore(
        path=config.get("path") or DEFAULT_QDRANT_PATH,
        collection_name=str(config.get("collection_name") or DEFAULT_COLLECTION_NAME),
        vector_size=int(config.get("vector_size") or 768),
    )
