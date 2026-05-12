from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen
from urllib.error import URLError


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG_PATH = ROOT / "config" / "paper-source-catalog.json"
DEFAULT_MANIFEST_DIR = ROOT / "data" / "papers" / "manifests"
DEFAULT_RAW_DIR = ROOT / "data" / "papers" / "raw"
USER_AGENT = "ToukeAgentPaperCollector/0.2 (+https://github.com/openai/codex)"
STOP_TEXT_MARKERS = {
    "abstract",
    "open access media",
    "paper",
    "presentation video",
    "slides",
    "download paper",
    "cite",
    "bibtex",
    "anthology id",
    "doi",
    "references",
}
ABSTRACT_NOISE_MARKERS = (
    "Use this form to create a GitHub issue with structured data describing the correction.",
    "Correct abstract if needed.",
    "Verification against PDF",
    "Authors concatenated from the text boxes above:",
    "Create GitHub issue for staff review",
)


def normalize_space(text: str | None) -> str:
    return " ".join(str(text or "").replace("\xa0", " ").split())


def clean_extracted_abstract(text: str | None) -> str | None:
    cleaned = normalize_space(text)
    if not cleaned:
        return None
    for marker in ABSTRACT_NOISE_MARKERS:
        if marker in cleaned:
            cleaned = normalize_space(cleaned.rsplit(marker, 1)[-1])
    return cleaned or None


def load_catalog(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def slugify(text: str) -> str:
    lowered = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower())
    return lowered.strip("-") or "paper"


def build_request(url: str) -> Request:
    return Request(url, headers={"User-Agent": USER_AGENT})


def fetch_url_bytes(url: str, timeout: int, retries: int = 2) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urlopen(build_request(url), timeout=timeout) as response:
                return response.read()
        except (TimeoutError, URLError, OSError) as error:
            last_error = error
            if attempt >= retries:
                break
            time.sleep(0.5 * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"failed to fetch url: {url}")


def request_json(url: str) -> dict[str, Any]:
    return json.loads(fetch_url_bytes(url, timeout=45, retries=2).decode("utf-8"))


def request_text(url: str) -> str:
    payload = fetch_url_bytes(url, timeout=60, retries=2)
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def request_bytes(url: str) -> bytes:
    return fetch_url_bytes(url, timeout=90, retries=2)


def years_between(from_year: int, to_year: int) -> list[int]:
    if from_year > to_year:
        raise ValueError("from_year must be <= to_year")
    return list(range(from_year, to_year + 1))


def resolve_conferences(catalog: dict[str, Any], selected_ids: list[str]) -> list[dict[str, Any]]:
    conferences = catalog.get("conferences") or []
    if not selected_ids or "all" in selected_ids:
        return conferences
    by_id = {item["id"]: item for item in conferences}
    missing = [item for item in selected_ids if item not in by_id]
    if missing:
        raise KeyError(f"unknown conference ids: {', '.join(missing)}")
    return [by_id[item] for item in selected_ids]


def plan_payload(
    catalog: dict[str, Any],
    conferences: list[dict[str, Any]],
    from_year: int,
    to_year: int,
    topic_profile: str,
) -> dict[str, Any]:
    years = years_between(from_year, to_year)
    return {
        "catalog_version": catalog.get("version"),
        "from_year": from_year,
        "to_year": to_year,
        "years": years,
        "topic_profile": topic_profile,
        "topic_keywords": list((catalog.get("topic_profiles") or {}).get(topic_profile, [])),
        "conferences": [
            {
                "id": item["id"],
                "display_name": item["display_name"],
                "domain": item["domain"],
                "provider": item.get("provider", "openalex"),
                "source_search": item["source_search"],
                "homepage_url": item["homepage_url"],
            }
            for item in conferences
        ],
    }


@dataclass
class SourceResolution:
    source_id: str
    source_key: str
    display_name: str
    source_type: str
    homepage_url: str | None


@dataclass
class CollectionBatch:
    provider: str
    source_id: str | None
    source_key: str | None
    source_display_name: str
    source_type: str
    source_url: str | None
    records: list[dict[str, Any]]


@dataclass
class BatchWindow:
    offset: int
    limit: int
    matched: int = 0
    selected: int = 0

    def accept(self) -> bool:
        current_index = self.matched
        self.matched += 1
        if current_index < self.offset:
            return False
        if self.limit > 0 and self.selected >= self.limit:
            return False
        self.selected += 1
        return True

    def done(self) -> bool:
        return self.limit > 0 and self.selected >= self.limit


class StructuredHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, list[str]] = {}
        self.anchors: list[dict[str, str]] = []
        self.texts: list[str] = []
        self._stack: list[str] = []
        self._anchor_href: str | None = None
        self._anchor_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value for key, value in attrs}
        self._stack.append(tag)
        if tag == "meta":
            key = attrs_dict.get("name") or attrs_dict.get("property")
            content = normalize_space(attrs_dict.get("content"))
            if key and content:
                self.meta.setdefault(key, []).append(content)
        elif tag == "a":
            self._anchor_href = attrs_dict.get("href")
            self._anchor_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor_href:
            text = normalize_space(" ".join(self._anchor_parts))
            self.anchors.append({"href": self._anchor_href, "text": text})
            self._anchor_href = None
            self._anchor_parts = []
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index] == tag:
                del self._stack[index]
                break

    def handle_data(self, data: str) -> None:
        if any(tag in {"script", "style", "noscript"} for tag in self._stack):
            return
        text = normalize_space(unescape(data))
        if not text:
            return
        self.texts.append(text)
        if self._anchor_href is not None:
            self._anchor_parts.append(text)


def parse_html_snapshot(html: str) -> StructuredHtmlParser:
    parser = StructuredHtmlParser()
    parser.feed(html)
    return parser


def first_meta(snapshot: StructuredHtmlParser, *keys: str) -> str | None:
    for key in keys:
        values = snapshot.meta.get(key) or []
        for value in values:
            cleaned = normalize_space(value)
            if cleaned:
                return cleaned
    return None


def all_meta(snapshot: StructuredHtmlParser, *keys: str) -> list[str]:
    values: list[str] = []
    for key in keys:
        values.extend(snapshot.meta.get(key) or [])
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = normalize_space(value)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped


def _token_score(target: str, candidate: str) -> int:
    tokens = [token for token in re.split(r"[^a-z0-9]+", target.lower()) if token]
    candidate_lower = candidate.lower()
    return sum(1 for token in tokens if token in candidate_lower)


def resolve_source(conference: dict[str, Any]) -> SourceResolution:
    queries = list(conference.get("source_searches") or [conference["source_search"]])
    expected_types = set(conference.get("expected_source_types") or [])
    ranked: list[tuple[int, dict[str, Any]]] = []
    seen_ids: set[str] = set()
    for query in queries:
        url = "https://api.openalex.org/sources?" + urlencode(
            {
                "search": query,
                "per-page": 10,
                "select": "id,display_name,type,homepage_url",
            }
        )
        payload = request_json(url)
        results = payload.get("results") or []
        for item in results:
            item_id = item.get("id")
            if not item_id or item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            score = _token_score(conference["display_name"], item.get("display_name", ""))
            score += _token_score(query, item.get("display_name", ""))
            if item.get("type") in expected_types:
                score += 3
            ranked.append((score, item))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    if not ranked or ranked[0][0] <= 0:
        raise RuntimeError(f"could not resolve source for {conference['id']}")
    winner = ranked[0][1]
    return SourceResolution(
        source_id=winner["id"],
        source_key=str(winner["id"]).rstrip("/").rsplit("/", 1)[-1],
        display_name=winner["display_name"],
        source_type=winner.get("type", "unknown"),
        homepage_url=winner.get("homepage_url"),
    )


def extract_pdf_url(work: dict[str, Any]) -> str | None:
    def looks_like_pdf(candidate: str | None) -> bool:
        if not candidate:
            return False
        lowered = candidate.lower()
        return lowered.endswith(".pdf") or "/pdf/" in lowered or "download=1" in lowered

    candidates = [
        ((work.get("best_oa_location") or {}).get("pdf_url")),
        ((work.get("primary_location") or {}).get("pdf_url")),
        ((work.get("open_access") or {}).get("oa_url")),
    ]
    for candidate in candidates:
        if looks_like_pdf(candidate):
            return candidate
    for location in work.get("locations") or []:
        pdf_url = (location or {}).get("pdf_url")
        if looks_like_pdf(pdf_url):
            return pdf_url
    return None


def matches_topic_profile_work(work: dict[str, Any], topic_keywords: list[str]) -> bool:
    if not topic_keywords:
        return True
    title = str(work.get("display_name") or "").lower()
    topic_names = " ".join(str(item.get("display_name") or "").lower() for item in (work.get("topics") or []))
    haystack = f"{title} {topic_names}"
    return any(keyword.lower() in haystack for keyword in topic_keywords)


def matches_topic_profile_record(record: dict[str, Any], topic_keywords: list[str]) -> bool:
    if not topic_keywords:
        return True
    haystack = " ".join(
        [
            str(record.get("title") or ""),
            str(record.get("abstract") or ""),
            " ".join(str(item) for item in (record.get("topics") or [])),
        ]
    ).lower()
    return any(keyword.lower() in haystack for keyword in topic_keywords)


def fetch_works_for_source(source_id: str, year: int, per_page: int = 200, max_pages: int = 20) -> list[dict[str, Any]]:
    cursor = "*"
    collected: list[dict[str, Any]] = []
    page_count = 0
    select_fields = ",".join(
        [
            "id",
            "display_name",
            "publication_year",
            "publication_date",
            "doi",
            "type",
            "open_access",
            "best_oa_location",
            "primary_location",
            "locations",
            "authorships",
            "topics",
            "cited_by_count",
        ]
    )
    while cursor and page_count < max_pages:
        params = {
            "filter": f"locations.source.id:{source_id},publication_year:{year},is_oa:true",
            "per-page": per_page,
            "cursor": cursor,
            "sort": "publication_date:desc",
            "select": select_fields,
        }
        url = "https://api.openalex.org/works?" + urlencode(params)
        payload = request_json(url)
        results = payload.get("results") or []
        collected.extend(results)
        cursor = ((payload.get("meta") or {}).get("next_cursor")) or None
        page_count += 1
        if not results:
            break
        time.sleep(0.15)
    return collected


def build_manifest_record(conference: dict[str, Any], resolution: SourceResolution, work: dict[str, Any]) -> dict[str, Any]:
    authors = [
        {
            "display_name": ((authorship.get("author") or {}).get("display_name")),
            "institutions": [item.get("display_name") for item in (authorship.get("institutions") or []) if item.get("display_name")],
        }
        for authorship in (work.get("authorships") or [])
    ]
    return {
        "conference_id": conference["id"],
        "conference_display_name": conference["display_name"],
        "conference_domain": conference["domain"],
        "collector": "openalex",
        "source_id": resolution.source_id,
        "source_key": resolution.source_key,
        "source_display_name": resolution.display_name,
        "source_type": resolution.source_type,
        "work_id": work.get("id"),
        "title": work.get("display_name"),
        "abstract": None,
        "publication_year": work.get("publication_year"),
        "publication_date": work.get("publication_date"),
        "doi": work.get("doi"),
        "open_access": work.get("open_access") or {},
        "pdf_url": extract_pdf_url(work),
        "landing_page_url": ((work.get("best_oa_location") or {}).get("landing_page_url"))
        or ((work.get("primary_location") or {}).get("landing_page_url")),
        "topics": [item.get("display_name") for item in (work.get("topics") or []) if item.get("display_name")],
        "cited_by_count": work.get("cited_by_count"),
        "authors": authors,
    }


def build_url_from_template(template: str, year: int) -> str:
    return template.format(year=year, yy=str(year)[-2:])


def collect_anchor_links(html: str, base_url: str, pattern: str) -> list[str]:
    matches = re.findall(pattern, html, flags=re.IGNORECASE)
    links: list[str] = []
    seen: set[str] = set()
    for match in matches:
        href = match[0] if isinstance(match, tuple) else match
        absolute = urljoin(base_url, href)
        cleaned = absolute.split("#", 1)[0]
        if cleaned in seen:
            continue
        seen.add(cleaned)
        links.append(cleaned)
    return links


def clean_title(text: str | None) -> str:
    title = normalize_space(text)
    for suffix in (" | USENIX", " - ACL Anthology", " | NDSS Symposium", " - NDSS Symposium"):
        if title.endswith(suffix):
            title = title[: -len(suffix)].strip()
    return title


def keep_record(provider: str, record: dict[str, Any]) -> bool:
    if provider in {"usenix", "ndss", "acl_anthology"} and not record.get("pdf_url"):
        return False
    if provider == "acl_anthology":
        title = str(record.get("title") or "")
        work_id = str(record.get("work_id") or "")
        if title.startswith("Proceedings of") or work_id.rstrip("/").endswith(".0"):
            return False
    return True


def pick_pdf_link(snapshot: StructuredHtmlParser, page_url: str) -> str | None:
    preferred: list[str] = []
    fallback: list[str] = []
    for anchor in snapshot.anchors:
        href = normalize_space(anchor.get("href"))
        text = normalize_space(anchor.get("text")).lower()
        absolute = urljoin(page_url, href)
        lowered = absolute.lower()
        if not href:
            continue
        if lowered.endswith(".pdf") or "/pdf/" in lowered or "download=1" in lowered:
            fallback.append(absolute)
            if any(token in text for token in ("paper", "pdf", "download")):
                preferred.append(absolute)
    if preferred:
        return preferred[0]
    if fallback:
        return fallback[0]
    meta_pdf = first_meta(snapshot, "citation_pdf_url")
    return urljoin(page_url, meta_pdf) if meta_pdf else None


def guess_authors(snapshot: StructuredHtmlParser, title: str) -> list[dict[str, Any]]:
    meta_authors = all_meta(snapshot, "citation_author")
    if meta_authors:
        return [{"display_name": item, "institutions": []} for item in meta_authors]

    title_index = -1
    for index, text in enumerate(snapshot.texts):
        if clean_title(text) == title:
            title_index = index
            break
    if title_index == -1:
        title_index = 0

    guessed: list[str] = []
    for text in snapshot.texts[title_index + 1 : title_index + 12]:
        lowered = text.lower()
        if lowered in STOP_TEXT_MARKERS:
            break
        if len(text) > 140:
            break
        if len(text.split()) < 2:
            continue
        if any(marker in lowered for marker in ("session", "track", "paper", "abstract", "copyright", "doi")):
            continue
        guessed.append(text)
        if len(guessed) >= 2:
            break
    if not guessed:
        return []
    merged = " ".join(guessed)
    names = [
        item.strip()
        for item in re.split(r",| and |;|\u00b7", merged)
        if item.strip() and len(item.strip().split()) <= 6
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    return [{"display_name": item, "institutions": []} for item in deduped]


def guess_abstract(snapshot: StructuredHtmlParser, title: str) -> str | None:
    meta_abstract = clean_extracted_abstract(first_meta(snapshot, "description", "twitter:description"))
    if meta_abstract and meta_abstract != title:
        return meta_abstract
    title_index = -1
    for index, text in enumerate(snapshot.texts):
        if clean_title(text) == title:
            title_index = index
            break
    if title_index == -1:
        title_index = 0

    abstract_parts: list[str] = []
    saw_abstract_marker = False
    for text in snapshot.texts[title_index + 1 :]:
        lowered = text.lower()
        if lowered == "abstract":
            saw_abstract_marker = True
            continue
        if lowered in STOP_TEXT_MARKERS and saw_abstract_marker:
            break
        if lowered in STOP_TEXT_MARKERS and not saw_abstract_marker:
            continue
        if not saw_abstract_marker and len(text) < 160:
            continue
        abstract_parts.append(text)
        if len(" ".join(abstract_parts)) >= 1200:
            break
    return clean_extracted_abstract(" ".join(abstract_parts))


def build_page_record(
    conference: dict[str, Any],
    provider: str,
    page_url: str,
    year: int,
    source_display_name: str,
    source_url: str,
    snapshot: StructuredHtmlParser,
) -> dict[str, Any]:
    title = clean_title(
        first_meta(snapshot, "citation_title", "og:title", "twitter:title")
        or (snapshot.texts[0] if snapshot.texts else page_url)
    )
    authors = guess_authors(snapshot, title)
    pdf_url = pick_pdf_link(snapshot, page_url)
    return {
        "conference_id": conference["id"],
        "conference_display_name": conference["display_name"],
        "conference_domain": conference["domain"],
        "collector": provider,
        "source_id": source_url,
        "source_key": conference["id"],
        "source_display_name": source_display_name,
        "source_type": "conference",
        "work_id": page_url,
        "title": title,
        "abstract": guess_abstract(snapshot, title),
        "publication_year": year,
        "publication_date": None,
        "doi": first_meta(snapshot, "citation_doi"),
        "open_access": {
            "is_oa": True,
            "oa_status": "collector_page",
            "oa_url": pdf_url or page_url,
            "any_repository_has_fulltext": bool(pdf_url),
        },
        "pdf_url": pdf_url,
        "landing_page_url": page_url,
        "topics": [],
        "cited_by_count": None,
        "authors": authors,
    }


def collect_openalex_records(
    conference: dict[str, Any],
    year: int,
    topic_keywords: list[str],
    window: BatchWindow,
) -> CollectionBatch:
    resolution = resolve_source(conference)
    works = fetch_works_for_source(resolution.source_key, year)
    records: list[dict[str, Any]] = []
    for work in works:
        if not matches_topic_profile_work(work, topic_keywords):
            continue
        if not window.accept():
            continue
        records.append(build_manifest_record(conference, resolution, work))
        if window.done():
            break
    return CollectionBatch(
        provider="openalex",
        source_id=resolution.source_id,
        source_key=resolution.source_key,
        source_display_name=resolution.display_name,
        source_type=resolution.source_type,
        source_url=resolution.homepage_url,
        records=records,
    )


def collect_usenix_records(
    conference: dict[str, Any],
    year: int,
    topic_keywords: list[str],
    window: BatchWindow,
) -> CollectionBatch:
    template = conference.get("technical_sessions_url_template")
    if not template:
        return CollectionBatch("usenix", None, None, conference["display_name"], "conference", None, [])
    sessions_url = build_url_from_template(template, year)
    html = request_text(sessions_url)
    page_urls = collect_anchor_links(html, sessions_url, r'href="([^"]+/presentation/[^"#?]+)"')
    records: list[dict[str, Any]] = []
    for page_url in page_urls:
        try:
            snapshot = parse_html_snapshot(request_text(page_url))
        except Exception:
            continue
        record = build_page_record(
            conference=conference,
            provider="usenix",
            page_url=page_url,
            year=year,
            source_display_name=conference["display_name"],
            source_url=sessions_url,
            snapshot=snapshot,
        )
        if not keep_record("usenix", record):
            continue
        if not matches_topic_profile_record(record, topic_keywords):
            continue
        if not window.accept():
            continue
        records.append(record)
        if window.done():
            break
        time.sleep(0.1)
    return CollectionBatch(
        provider="usenix",
        source_id=sessions_url,
        source_key=conference["id"],
        source_display_name=conference["display_name"],
        source_type="conference",
        source_url=sessions_url,
        records=records,
    )


def collect_ndss_records(
    conference: dict[str, Any],
    year: int,
    topic_keywords: list[str],
    window: BatchWindow,
) -> CollectionBatch:
    template = conference.get("accepted_papers_url_template")
    if not template:
        return CollectionBatch("ndss", None, None, conference["display_name"], "conference", None, [])
    accepted_url = build_url_from_template(template, year)
    html = request_text(accepted_url)
    page_urls = collect_anchor_links(html, accepted_url, r'href="([^"]+/ndss-paper/[^"#?]+/?|/ndss-paper/[^"#?]+/?)"')
    records: list[dict[str, Any]] = []
    for page_url in page_urls:
        try:
            snapshot = parse_html_snapshot(request_text(page_url))
        except Exception:
            continue
        record = build_page_record(
            conference=conference,
            provider="ndss",
            page_url=page_url,
            year=year,
            source_display_name=conference["display_name"],
            source_url=accepted_url,
            snapshot=snapshot,
        )
        if not keep_record("ndss", record):
            continue
        if not matches_topic_profile_record(record, topic_keywords):
            continue
        if not window.accept():
            continue
        records.append(record)
        if window.done():
            break
        time.sleep(0.1)
    return CollectionBatch(
        provider="ndss",
        source_id=accepted_url,
        source_key=conference["id"],
        source_display_name=conference["display_name"],
        source_type="conference",
        source_url=accepted_url,
        records=records,
    )


def collect_acl_anthology_records(
    conference: dict[str, Any],
    year: int,
    topic_keywords: list[str],
    window: BatchWindow,
) -> CollectionBatch:
    volumes_by_year = conference.get("anthology_volumes_by_year") or {}
    volume_ids = list(volumes_by_year.get(str(year)) or [])
    records: list[dict[str, Any]] = []
    source_display = conference["display_name"]
    source_url = conference["homepage_url"]
    for volume_id in volume_ids:
        volume_url = f"https://aclanthology.org/volumes/{volume_id}/"
        try:
            snapshot = parse_html_snapshot(request_text(volume_url))
        except Exception:
            continue
        page_urls: list[str] = []
        seen_urls: set[str] = set()
        for anchor in snapshot.anchors:
            href = normalize_space(anchor.get("href"))
            if not href:
                continue
            absolute = urljoin(volume_url, href).split("#", 1)[0]
            if not re.search(rf"/{re.escape(volume_id)}\.\d+/?$", absolute):
                continue
            if absolute in seen_urls:
                continue
            seen_urls.add(absolute)
            page_urls.append(absolute)
        for page_url in page_urls:
            try:
                snapshot = parse_html_snapshot(request_text(page_url))
            except Exception:
                continue
            record = build_page_record(
                conference=conference,
                provider="acl_anthology",
                page_url=page_url,
                year=year,
                source_display_name=source_display,
                source_url=volume_url,
                snapshot=snapshot,
            )
            if not keep_record("acl_anthology", record):
                continue
            if not matches_topic_profile_record(record, topic_keywords):
                continue
            if not window.accept():
                continue
            records.append(record)
            if window.done():
                return CollectionBatch(
                    provider="acl_anthology",
                    source_id=volume_url,
                    source_key=volume_id,
                    source_display_name=source_display,
                    source_type="conference",
                    source_url=volume_url,
                    records=records,
                )
            time.sleep(0.05)
        source_url = volume_url
    return CollectionBatch(
        provider="acl_anthology",
        source_id=source_url,
        source_key=conference["id"],
        source_display_name=source_display,
        source_type="conference",
        source_url=source_url,
        records=records,
    )


def collect_records_for_conference(
    conference: dict[str, Any],
    year: int,
    topic_keywords: list[str],
    offset: int,
    limit: int,
) -> CollectionBatch:
    window = BatchWindow(offset=max(0, offset), limit=max(0, limit))
    provider = conference.get("provider", "openalex")
    if provider == "openalex":
        return collect_openalex_records(conference, year, topic_keywords, window)
    if provider == "usenix":
        return collect_usenix_records(conference, year, topic_keywords, window)
    if provider == "ndss":
        return collect_ndss_records(conference, year, topic_keywords, window)
    if provider == "acl_anthology":
        return collect_acl_anthology_records(conference, year, topic_keywords, window)
    raise KeyError(f"unknown collector provider: {provider}")


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_manifest(path: Path, records: list[dict[str, Any]]) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"manifest not found: {path}")
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def download_pdf(record: dict[str, Any], raw_dir: Path) -> str | None:
    pdf_url = record.get("pdf_url")
    if not pdf_url:
        return None
    title_slug = slugify(str(record.get("title") or "paper"))
    year = str(record.get("publication_year") or "unknown")
    output_path = raw_dir / str(record["conference_id"]) / year / f"{title_slug}.pdf"
    if output_path.exists():
        return str(output_path)
    ensure_parent(output_path)
    payload = request_bytes(pdf_url)
    output_path.write_bytes(payload)
    return str(output_path)


def derive_manifest_path(manifest_dir: Path, conference_id: str, year: int, offset: int, limit: int) -> Path:
    base_name = f"{conference_id}-{year}"
    if offset > 0 or limit > 0:
        limit_suffix = str(limit) if limit > 0 else "all"
        base_name = f"{base_name}-offset{offset}-limit{limit_suffix}"
    return manifest_dir / f"{base_name}.jsonl"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect open-access papers for ToukeAgent.")
    parser.add_argument("--catalog-path", default=str(DEFAULT_CATALOG_PATH))
    parser.add_argument("--conference", action="append", default=[])
    parser.add_argument("--from-year", type=int)
    parser.add_argument("--to-year", type=int)
    parser.add_argument("--topic-profile", default="all")
    parser.add_argument("--manifest-dir", default=str(DEFAULT_MANIFEST_DIR))
    parser.add_argument("--manifest-path")
    parser.add_argument("--raw-dir", default=str(DEFAULT_RAW_DIR))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--print-plan", action="store_true")
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--download-pdfs", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    catalog_path = Path(args.catalog_path)
    catalog = load_catalog(catalog_path)
    default_year_range = catalog.get("default_year_range") or {}
    from_year = args.from_year or int(default_year_range.get("from"))
    to_year = args.to_year or int(default_year_range.get("to"))
    conferences = resolve_conferences(catalog, args.conference)
    topic_profile = args.topic_profile
    topic_keywords = list((catalog.get("topic_profiles") or {}).get(topic_profile, []))
    if topic_profile not in (catalog.get("topic_profiles") or {}):
        raise KeyError(f"unknown topic profile: {topic_profile}")

    plan = plan_payload(catalog, conferences, from_year, to_year, topic_profile)
    if args.print_plan:
        json.dump(plan, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    manifest_dir = Path(args.manifest_dir)
    raw_dir = Path(args.raw_dir)

    if args.manifest_path:
        manifest_path = Path(args.manifest_path)
        records = read_manifest(manifest_path)
        start = max(0, args.offset)
        stop = start + args.limit if args.limit > 0 else None
        selected_records = records[start:stop]
        downloaded = 0
        if args.download_pdfs and not args.metadata_only:
            for record in selected_records:
                saved_path = download_pdf(record, raw_dir)
                if saved_path:
                    record["local_pdf_path"] = saved_path
                    downloaded += 1
                    time.sleep(0.1)
            write_manifest(manifest_path, records)
        summary = {
            "plan": None,
            "runs": [
                {
                    "conference_id": selected_records[0]["conference_id"] if selected_records else None,
                    "conference_display_name": selected_records[0]["conference_display_name"] if selected_records else None,
                    "provider": "manifest_batch",
                    "year": selected_records[0]["publication_year"] if selected_records else None,
                    "source_id": None,
                    "source_key": None,
                    "source_display_name": "manifest_batch",
                    "source_type": "manifest",
                    "source_url": str(manifest_path),
                    "records": len(selected_records),
                    "downloaded_pdfs": downloaded,
                    "manifest_path": str(manifest_path),
                    "offset": start,
                    "limit": args.limit,
                }
            ],
            "total_records": len(selected_records),
            "total_downloaded_pdfs": downloaded,
        }
        json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    summary: dict[str, Any] = {"plan": plan, "runs": []}
    total_records = 0
    total_downloads = 0

    for conference in conferences:
        for year in years_between(from_year, to_year):
            manifest_path = derive_manifest_path(manifest_dir, conference["id"], year, args.offset, args.limit)
            try:
                batch = collect_records_for_conference(conference, year, topic_keywords, args.offset, args.limit)
                records = batch.records
                write_manifest(manifest_path, records)
                downloaded = 0
                if args.download_pdfs and not args.metadata_only:
                    for record in records:
                        saved_path = download_pdf(record, raw_dir)
                        if saved_path:
                            record["local_pdf_path"] = saved_path
                            downloaded += 1
                            total_downloads += 1
                            time.sleep(0.1)
                    write_manifest(manifest_path, records)
                summary["runs"].append(
                    {
                        "conference_id": conference["id"],
                        "conference_display_name": conference["display_name"],
                        "provider": batch.provider,
                        "year": year,
                        "source_id": batch.source_id,
                        "source_key": batch.source_key,
                        "source_display_name": batch.source_display_name,
                        "source_type": batch.source_type,
                        "source_url": batch.source_url,
                        "records": len(records),
                        "downloaded_pdfs": downloaded,
                        "manifest_path": str(manifest_path),
                        "offset": args.offset,
                        "limit": args.limit,
                    }
                )
                total_records += len(records)
            except Exception as error:
                summary["runs"].append(
                    {
                        "conference_id": conference["id"],
                        "conference_display_name": conference["display_name"],
                        "provider": conference.get("provider", "openalex"),
                        "year": year,
                        "source_id": None,
                        "source_key": conference["id"],
                        "source_display_name": conference["display_name"],
                        "source_type": "conference",
                        "source_url": conference.get("homepage_url"),
                        "records": 0,
                        "downloaded_pdfs": 0,
                        "manifest_path": str(manifest_path),
                        "offset": args.offset,
                        "limit": args.limit,
                        "error": str(error),
                    }
                )

    summary["total_records"] = total_records
    summary["total_downloaded_pdfs"] = total_downloads
    manifest_dir.mkdir(parents=True, exist_ok=True)
    summary_path = manifest_dir / "last-run-summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
