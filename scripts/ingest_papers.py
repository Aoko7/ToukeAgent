from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_OUTPUT_DIR = ROOT / "data" / "papers"
DEFAULT_NORMALIZED_DIR = DEFAULT_OUTPUT_DIR / "normalized"
DEFAULT_CHUNKS_DIR = DEFAULT_OUTPUT_DIR / "chunks"
MIN_CHUNK_CHARS = 40

HEADING_PATTERN = re.compile(r"^(?P<number>\d+(?:\.\d+)*)\s+(?P<title>[A-Z][A-Za-z0-9 ,:/()\-]{2,})$")
ROMAN_HEADING_PATTERN = re.compile(r"^(?P<number>[IVXLCDM]+)\.\s+(?P<title>[A-Z][A-Z0-9 ,:/()\-]{2,})$")
NUMERIC_ONLY_PATTERN = re.compile(r"^[\d\s.,:+\-/%()]+$")
UNICODE_GLYPH_PATTERN = re.compile(r"(?:/uni[0-9a-fA-F]{8}\s*){4,}")
PSEUDO_HEADING_PATTERN = re.compile(r"^(?:\d+[.)]?\s+)?(?:\([a-z]\)\s*){2,}.*$", re.IGNORECASE)
DECIMAL_AXIS_PATTERN = re.compile(r"\b\d+(?:\.\d+){2,}\b")
BACK_MATTER_HEADINGS = (
    "\nReferences\n",
    "\nREFERENCES\n",
)


def normalize_space(text: str | None) -> str:
    value = str(text or "").encode("utf-8", "replace").decode("utf-8", "replace")
    return " ".join(value.replace("\xa0", " ").split())


def sanitize_text(text: str | None) -> str:
    return str(text or "").encode("utf-8", "replace").decode("utf-8", "replace")


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {sanitize_text(key): sanitize_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    if isinstance(value, str):
        return sanitize_text(value)
    return value


def detect_language(text: str | None) -> str:
    sample = str(text or "")
    if any("\u4e00" <= char <= "\u9fff" for char in sample):
        return "zh"
    return "en"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def read_manifest(path: Path, *, limit: int = 0) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
            if limit > 0 and len(records) >= limit:
                break
    return records


def load_pdf_pages(pdf_path: Path) -> tuple[list[str], str]:
    try:
        from pypdf import PdfReader
    except Exception:
        return [], "pypdf_missing"

    try:
        reader = PdfReader(str(pdf_path))
    except Exception as exc:
        return [], f"pypdf_error:{exc.__class__.__name__}"

    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(sanitize_text(page.extract_text() or ""))
        except Exception as exc:
            return pages, f"pypdf_page_error:{exc.__class__.__name__}"
    return pages, "pypdf"


def clean_pdf_text(text: str) -> str:
    cleaned = text.replace("\r", "\n")
    cleaned = re.sub(r"([A-Za-z])-\n([A-Za-z])", r"\1\2", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    lines = [line.strip() for line in cleaned.splitlines()]
    kept: list[str] = []
    for line in lines:
        normalized = normalize_space(line)
        if not normalized:
            kept.append("")
            continue
        lowered = normalized.lower()
        if lowered.startswith("proceedings of the ") and "association for computational linguistics" in lowered:
            continue
        if lowered.startswith("august ") and "association for computational linguistics" in lowered:
            continue
        if lowered.startswith("this paper is included in the proceedings of the "):
            continue
        if lowered.startswith("open access to the proceedings of the "):
            continue
        if "usenix security symposium" in lowered and "philadelphia" in lowered:
            continue
        if lowered.startswith("isbn ") and "ndss-symposium.org" in lowered:
            continue
        if "26 february - 1 march 2024" in lowered and "san diego" in lowered:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        kept.append(normalized)
    cleaned = "\n".join(kept)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    framed = f"\n{cleaned}\n"
    back_matter_start = min(
        [index for heading in BACK_MATTER_HEADINGS if (index := framed.find(heading)) != -1] or [-1]
    )
    if back_matter_start != -1:
        cleaned = framed[:back_matter_start].strip()
    return cleaned.strip()


def split_paragraphs(text: str) -> list[str]:
    if not text.strip():
        return []
    paragraphs = [normalize_space(part) for part in re.split(r"\n\s*\n", text) if normalize_space(part)]
    return paragraphs


def parse_heading(line: str) -> dict[str, Any] | None:
    normalized = normalize_space(line)
    if not normalized:
        return None
    if normalized == "Abstract":
        return {
            "heading": normalized,
            "level": 1,
            "kind": "named",
        }
    match = HEADING_PATTERN.match(normalized)
    if match:
        number = match.group("number")
        components = number.split(".")
        if len(components) > 3:
            return None
        if any(len(component) > 1 and component.startswith("0") for component in components):
            return None
        return {
            "heading": normalized,
            "level": number.count(".") + 1,
            "kind": "numeric",
        }
    match = ROMAN_HEADING_PATTERN.match(normalized)
    if match:
        return {
            "heading": normalized,
            "level": 1,
            "kind": "roman",
        }
    return None


def looks_suspicious_heading(text: str) -> bool:
    normalized = normalize_space(text)
    if not normalized:
        return True
    if UNICODE_GLYPH_PATTERN.search(normalized):
        return True
    if DECIMAL_AXIS_PATTERN.search(normalized):
        return True
    if PSEUDO_HEADING_PATTERN.match(normalized):
        return True

    alpha_chars = sum(char.isalpha() for char in normalized)
    digit_chars = sum(char.isdigit() for char in normalized)
    tokens = normalized.split()
    numeric_tokens = [token for token in tokens if any(char.isdigit() for char in token)]
    long_alpha_tokens = [token for token in tokens if len(token) >= 4 and any(char.isalpha() for char in token)]

    if len(normalized) < 40 and len(long_alpha_tokens) <= 1 and len(numeric_tokens) >= 1:
        return True
    if digit_chars > alpha_chars and len(numeric_tokens) >= 2:
        return True
    return False


def extract_sections(text: str) -> list[dict[str, Any]]:
    raw_lines = [line.strip() for line in text.splitlines()]
    normalized_lines: list[str] = []
    index = 0
    while index < len(raw_lines):
        line = normalize_space(raw_lines[index])
        if not line:
            normalized_lines.append("")
            index += 1
            continue
        if re.fullmatch(r"\d+(?:\.\d+)*", line):
            next_line = normalize_space(raw_lines[index + 1]) if index + 1 < len(raw_lines) else ""
            if next_line and re.match(r"^[A-Z][A-Za-z0-9 ,:/()\-]{2,}$", next_line):
                normalized_lines.append(f"{line} {next_line}")
                index += 2
                continue
        if re.fullmatch(r"[IVXLCDM]+\.", line):
            next_line = normalize_space(raw_lines[index + 1]) if index + 1 < len(raw_lines) else ""
            if next_line and re.match(r"^[A-Z][A-Z0-9 ,:/()\-]{2,}$", next_line):
                normalized_lines.append(f"{line} {next_line}")
                index += 2
                continue
        normalized_lines.append(line)
        index += 1

    sections: list[dict[str, Any]] = []
    current_heading = "Front Matter"
    current_path = ["Front Matter"]
    current_lines: list[str] = []
    heading_stack: list[str] = []

    def flush_section() -> None:
        nonlocal current_lines
        body = "\n".join(current_lines).strip()
        if not body:
            current_lines = []
            return
        paragraphs = split_paragraphs(body) or [normalize_space(body)]
        sections.append(
            {
                "heading": current_heading,
                "section_path": list(current_path),
                "text": "\n\n".join(paragraphs),
            }
        )
        current_lines = []

    for line in normalized_lines:
        if not line:
            if current_lines and current_lines[-1] != "":
                current_lines.append("")
            continue
        heading = parse_heading(line)
        if heading:
            flush_section()
            current_heading = str(heading["heading"])
            level = int(heading["level"])
            if heading["kind"] in {"named", "roman"}:
                heading_stack = [current_heading]
            else:
                heading_stack = heading_stack[: max(level - 1, 0)]
                heading_stack.append(current_heading)
            current_path = list(heading_stack) or [current_heading]
            continue
        current_lines.append(line)

    flush_section()
    return sections


def looks_low_signal_fragment(text: str) -> bool:
    normalized = normalize_space(text)
    if not normalized:
        return True
    if UNICODE_GLYPH_PATTERN.search(normalized):
        return True
    if DECIMAL_AXIS_PATTERN.search(normalized) and normalized.count("(") >= 2:
        return True
    if NUMERIC_ONLY_PATTERN.fullmatch(normalized):
        return True
    if "@" in normalized and len(normalized) < 80:
        return True
    if normalized.count("−") >= 6 or normalized.count("—") >= 6:
        return True

    alpha_chars = sum(char.isalpha() for char in normalized)
    digit_chars = sum(char.isdigit() for char in normalized)
    tokens = normalized.split()
    numeric_tokens = [token for token in tokens if any(char.isdigit() for char in token)]
    long_alpha_tokens = [
        token
        for token in tokens
        if len(token) >= 3 and any(char.isalpha() for char in token)
    ]

    if alpha_chars == 0:
        return True
    if PSEUDO_HEADING_PATTERN.match(normalized) and len(normalized) < 180:
        return True
    if len(normalized) < MIN_CHUNK_CHARS and len(long_alpha_tokens) <= 1:
        return True
    if len(normalized) < 60 and len(numeric_tokens) >= 3:
        return True
    if len(normalized) < 24 and digit_chars >= alpha_chars:
        return True
    if len(tokens) >= 6 and len(long_alpha_tokens) <= 2 and len(numeric_tokens) >= 2:
        return True
    if normalized.count("/") >= 3 and len(long_alpha_tokens) <= 2:
        return True
    if len(re.findall(r"\([a-z]\)", normalized, flags=re.IGNORECASE)) >= 2 and DECIMAL_AXIS_PATTERN.search(normalized):
        return True
    if re.search(r"\b(?:TPR|TNR|FPR|FNR|FPP|FNP|AUC|ROC)\b", normalized) and len(numeric_tokens) >= 3:
        return True
    return False


def merge_short_paragraphs(paragraphs: list[str], *, max_chars: int) -> list[str]:
    merged: list[str] = []
    for paragraph in paragraphs:
        normalized = normalize_space(paragraph)
        if not normalized:
            continue
        if merged and (
            len(normalized) < MIN_CHUNK_CHARS
            or looks_low_signal_fragment(normalized)
        ):
            candidate = f"{merged[-1]}\n{normalized}"
            if len(candidate) <= max_chars + MIN_CHUNK_CHARS:
                merged[-1] = candidate
                continue
        merged.append(normalized)

    if len(merged) > 1 and len(merged[0]) < MIN_CHUNK_CHARS:
        merged[1] = f"{merged[0]}\n{merged[1]}"
        merged = merged[1:]
    if len(merged) > 1 and len(merged[-1]) < MIN_CHUNK_CHARS:
        merged[-2] = f"{merged[-2]}\n{merged[-1]}"
        merged.pop()
    if len(merged) == 1 and looks_low_signal_fragment(merged[0]):
        return []
    return merged


def split_long_paragraph(paragraph: str, *, max_chars: int, overlap_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]

    pieces: list[str] = []
    start = 0
    text = paragraph.strip()
    while start < len(text):
        tentative_end = min(len(text), start + max_chars)
        end = tentative_end
        if tentative_end < len(text):
            boundary = text.rfind(" ", start + MIN_CHUNK_CHARS, tentative_end)
            if boundary != -1 and boundary - start >= MIN_CHUNK_CHARS:
                end = boundary
        piece = normalize_space(text[start:end])
        if piece:
            pieces.append(piece)
        if end >= len(text):
            break
        next_start = max(start + MIN_CHUNK_CHARS, end - overlap_chars)
        while next_start < len(text) and text[next_start].isspace():
            next_start += 1
        start = next_start

    if len(pieces) > 1 and len(pieces[-1]) < MIN_CHUNK_CHARS:
        pieces[-2] = normalize_space(f"{pieces[-2]} {pieces[-1]}")
        pieces.pop()
    return pieces


def finalize_chunk_texts(chunks: list[str], *, max_chars: int) -> list[str]:
    merged: list[str] = []
    for chunk in chunks:
        normalized = normalize_space(chunk)
        if not normalized:
            continue
        if merged and (
            len(normalized) < MIN_CHUNK_CHARS
            or looks_low_signal_fragment(normalized)
        ):
            merged[-1] = normalize_space(f"{merged[-1]} {normalized}")
            continue
        merged.append(normalized)

    if len(merged) > 1 and len(merged[0]) < MIN_CHUNK_CHARS:
        merged[1] = normalize_space(f"{merged[0]} {merged[1]}")
        merged = merged[1:]
    if len(merged) > 1 and len(merged[-1]) < MIN_CHUNK_CHARS:
        merged[-2] = normalize_space(f"{merged[-2]} {merged[-1]}")
        merged.pop()

    deduped: list[str] = []
    seen_texts: set[str] = set()
    for chunk in merged:
        if len(chunk) < MIN_CHUNK_CHARS and looks_low_signal_fragment(chunk):
            continue
        normalized_key = normalize_space(chunk).casefold()
        if normalized_key in seen_texts:
            continue
        seen_texts.add(normalized_key)
        deduped.append(chunk)

    return [chunk[: max_chars + MIN_CHUNK_CHARS] for chunk in deduped]


def chunk_section_text(section: dict[str, Any], *, max_chars: int = 1400, overlap_chars: int = 180) -> list[dict[str, Any]]:
    text = str(section.get("text") or "").strip()
    if not text:
        return []
    if looks_suspicious_heading(str(section.get("heading") or "")) and looks_low_signal_fragment(text):
        return []

    paragraphs = merge_short_paragraphs([part for part in split_paragraphs(text) if part], max_chars=max_chars)
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
        if len(paragraph) <= max_chars:
            current = paragraph
            continue
        chunks.extend(split_long_paragraph(paragraph, max_chars=max_chars, overlap_chars=overlap_chars))
        current = ""
    if current:
        chunks.append(current)

    chunk_texts = finalize_chunk_texts(chunks, max_chars=max_chars)

    return [
        {
            "title": section.get("heading") or "Section",
            "section_path": list(section.get("section_path") or []),
            "text": chunk_text,
        }
        for chunk_text in chunk_texts
    ]


def build_paper_card(record: dict[str, Any], *, language: str, extraction_status: str, needs_ocr: bool) -> dict[str, Any]:
    authors = [item.get("display_name") for item in (record.get("authors") or []) if item.get("display_name")]
    return {
        "paper_id": str(record.get("work_id") or record.get("doi") or record.get("title")),
        "title": record.get("title"),
        "conference_id": record.get("conference_id"),
        "conference_display_name": record.get("conference_display_name"),
        "conference_domain": record.get("conference_domain"),
        "publication_year": record.get("publication_year"),
        "doi": record.get("doi"),
        "authors": authors,
        "abstract": record.get("abstract"),
        "landing_page_url": record.get("landing_page_url"),
        "pdf_url": record.get("pdf_url"),
        "local_pdf_path": record.get("local_pdf_path"),
        "language": language,
        "extraction_status": extraction_status,
        "needs_ocr": needs_ocr,
    }


def build_rag_document(record: dict[str, Any], paper_card: dict[str, Any]) -> dict[str, Any]:
    doc_id = f"paper::{record.get('conference_id')}::{record.get('publication_year')}::{slugify(str(record.get('title') or 'paper'))}"
    return {
        "doc_id": doc_id,
        "title": record.get("title"),
        "source_type": "rag",
        "doc_type": "paper",
        "project": "paper_corpus",
        "tags": [record.get("conference_id"), record.get("conference_domain"), "paper"],
        "authority": "conference_proceedings",
        "visibility": "local",
        "created_at": None,
        "updated_at": None,
        "metadata": {
            "conference_id": record.get("conference_id"),
            "conference_display_name": record.get("conference_display_name"),
            "publication_year": record.get("publication_year"),
            "language": paper_card.get("language"),
            "paper_id": paper_card.get("paper_id"),
            "landing_page_url": record.get("landing_page_url"),
            "local_pdf_path": record.get("local_pdf_path"),
        },
    }


def slugify(text: str) -> str:
    lowered = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower())
    return lowered.strip("-") or "paper"


def build_chunk_records(
    record: dict[str, Any],
    paper_card: dict[str, Any],
    rag_document: dict[str, Any],
    sections: list[dict[str, Any]],
    *,
    embedding_model: str,
    embedding_dim: int,
    vector_backend: str,
    max_chars: int = 1400,
    overlap_chars: int = 180,
) -> list[dict[str, Any]]:
    chunk_records: list[dict[str, Any]] = []
    chunk_index = 0
    seen_chunk_texts: set[str] = set()
    for section in sections:
        for chunk in chunk_section_text(section, max_chars=max_chars, overlap_chars=overlap_chars):
            normalized_key = normalize_space(str(chunk.get("text") or "")).casefold()
            if not normalized_key or normalized_key in seen_chunk_texts:
                continue
            seen_chunk_texts.add(normalized_key)
            chunk_index += 1
            chunk_records.append(
                {
                    "chunk_id": f"{rag_document['doc_id']}::chunk::{chunk_index}",
                    "doc_id": rag_document["doc_id"],
                    "title": chunk["title"],
                    "section_path": chunk["section_path"],
                    "text": chunk["text"],
                    "semantic_vector_ref": None,
                    "bm25_terms_ref": None,
                    "embedding_model": embedding_model,
                    "embedding_dim": embedding_dim,
                    "vector_backend": vector_backend,
                    "freshness": "stable",
                    "entity_refs": [paper_card["paper_id"]],
                    "metadata": {
                        "conference_id": record.get("conference_id"),
                        "publication_year": record.get("publication_year"),
                        "paper_title": record.get("title"),
                        "language": paper_card.get("language"),
                        "source_manifest": record.get("source_id"),
                        "local_pdf_path": record.get("local_pdf_path"),
                        "needs_ocr": paper_card.get("needs_ocr"),
                    },
                }
            )
    return chunk_records


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            safe = sanitize_json_value(row)
            payload = json.dumps(safe, ensure_ascii=False)
            payload = payload.encode("utf-8", "replace").decode("utf-8", "replace")
            handle.write(payload + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize paper manifests and PDFs into paper cards and RAG chunks.")
    parser.add_argument("--manifest-path", required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--chunk-max-chars", type=int, default=1400)
    parser.add_argument("--chunk-overlap-chars", type=int, default=180)
    parser.add_argument("--abstract-only", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    manifest_path = Path(args.manifest_path)
    output_dir = Path(args.output_dir)
    normalized_dir = output_dir / "normalized"
    chunks_dir = output_dir / "chunks"
    records = read_manifest(manifest_path, limit=args.limit)

    from toukeagent_core.embedding import describe_embedding_strategy
    from toukeagent_core.vector_store import describe_vector_backend

    embedding_strategy = describe_embedding_strategy()
    vector_backend = describe_vector_backend()

    paper_cards: list[dict[str, Any]] = []
    rag_documents: list[dict[str, Any]] = []
    rag_chunks: list[dict[str, Any]] = []
    extracted_count = 0
    abstract_only_count = 0
    needs_ocr_count = 0

    for record in records:
        pdf_path = Path(str(record.get("local_pdf_path") or ""))
        extracted_text = ""
        extraction_status = "abstract_only"
        if not args.abstract_only and pdf_path.exists():
            pages, extraction_status = load_pdf_pages(pdf_path)
            extracted_text = clean_pdf_text("\n\n".join(pages))
        if not extracted_text:
            abstract_only_count += 1
            extracted_text = normalize_space(record.get("abstract"))
        else:
            extracted_count += 1

        language = detect_language(f"{record.get('title') or ''}\n{extracted_text}")
        needs_ocr = len(extracted_text) < 1200
        if needs_ocr:
            needs_ocr_count += 1

        paper_card = build_paper_card(
            record,
            language=language,
            extraction_status=extraction_status,
            needs_ocr=needs_ocr,
        )
        rag_document = build_rag_document(record, paper_card)
        sections = extract_sections(extracted_text)
        if not sections and extracted_text:
            sections = [{"heading": "Body", "section_path": ["Body"], "text": extracted_text}]

        chunk_records = build_chunk_records(
            record,
            paper_card,
            rag_document,
            sections,
            embedding_model=str(embedding_strategy.get("active_model") or embedding_strategy.get("primary_model")),
            embedding_dim=int(embedding_strategy.get("dimensions") or 0),
            vector_backend=str(vector_backend.get("kind") or "qdrant_local"),
            max_chars=args.chunk_max_chars,
            overlap_chars=args.chunk_overlap_chars,
        )

        paper_cards.append(paper_card)
        rag_documents.append(rag_document)
        rag_chunks.extend(chunk_records)

    cards_path = normalized_dir / f"{manifest_path.stem}.paper_cards.jsonl"
    docs_path = normalized_dir / f"{manifest_path.stem}.rag_documents.jsonl"
    chunks_path = chunks_dir / f"{manifest_path.stem}.rag_chunks.jsonl"
    write_jsonl(cards_path, paper_cards)
    write_jsonl(docs_path, rag_documents)
    write_jsonl(chunks_path, rag_chunks)

    summary = {
        "manifest_path": str(manifest_path),
        "records": len(records),
        "paper_cards": len(paper_cards),
        "rag_documents": len(rag_documents),
        "rag_chunks": len(rag_chunks),
        "extracted_from_pdf": extracted_count,
        "abstract_only": abstract_only_count,
        "needs_ocr": needs_ocr_count,
        "embedding_strategy": embedding_strategy,
        "vector_backend": vector_backend,
        "outputs": {
            "paper_cards_path": str(cards_path),
            "rag_documents_path": str(docs_path),
            "rag_chunks_path": str(chunks_path),
        },
    }
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
