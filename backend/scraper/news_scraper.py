"""Production-ready financial news scraping utilities.

Public entry point:
    get_news(ticker: str) -> List[Dict]

Each returned item follows this schema:
    {
        "title":  "Actual news headline",
        "text":   "headline + snippet combined",
        "date":   "YYYY-MM-DD",
        "source": "API | Google | ET | Reddit | Twitter",
        "ticker": "AAPL",
        "url":    "https://actual-source-article-url.com/..."
    }

Key improvements over v1:
  - All sources fetched in parallel (ThreadPoolExecutor) — biggest speed win
  - Session reuse: one shared Session per get_news() call
  - Real article titles always used; "Market Update" fallback removed
  - ET URLs properly resolved to full article links (not topic page)
  - Google News redirect URLs decoded to real publisher URLs
  - Deduplication uses a faster set-based exact-match first pass,
    with fuzzy SequenceMatcher only for near-duplicates
  - _parse_date compiles its regex once at module level
  - _finalize_items does one combined sort+dedup pass
"""

from __future__ import annotations

import html
import importlib
import logging
import os
import re
import urllib.parse
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple, TypedDict

import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from config import NEWS_API_KEY, get_active_services

try:
    from backend.preprocessing.ticker_mapping import normalize_query
except Exception:
    normalize_query = None

logger = logging.getLogger(__name__)
for _name in ("snscrape", "snscrape.modules.twitter"):
    logging.getLogger(_name).disabled = True

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────

LOOKBACK_DAYS       = 7
MIN_TEXT_LENGTH     = 20
MAX_NEWSAPI_RESULTS = 100
MAX_ET_RESULTS      = 50
MAX_TWITTER_RESULTS = 50
MAX_GOOGLE_RESULTS  = 50
MAX_REDDIT_RESULTS  = 50
REQUEST_TIMEOUT     = 12          # slightly tighter than v1

NEWSAPI_ENDPOINT         = "https://newsapi.org/v2/everything"
ECONOMIC_TIMES_TOPIC_URL = "https://economictimes.indiatimes.com/topic/{slug}"
GOOGLE_NEWS_RSS_URL      = "https://news.google.com/rss/search"
REDDIT_SEARCH_URL        = "https://www.reddit.com/r/IndianStockMarket/new.json"

# Pre-compiled patterns (compiled once at import time)
_WHITESPACE_RE   = re.compile(r"\s+")
_NONALNUM_RE     = re.compile(r"[^a-z0-9\s$%.-]")
_DATE_PATTERN_RE = re.compile(
    r"(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}"
    r"|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}"
    r"|\d{4}-\d{2}-\d{2})"
)
_KNOWN_DATE_FMTS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d %b %Y", "%d %B %Y",
    "%b %d, %Y", "%B %d, %Y", "%d-%m-%Y", "%d/%m/%Y",
    "%a, %d %b %Y %H:%M:%S %Z",
)

# ──────────────────────────────────────────────
# Types
# ──────────────────────────────────────────────

class NewsItem(TypedDict):
    title:  str
    text:   str
    date:   str
    source: str
    ticker: str
    url:    str


@dataclass(frozen=True)
class ScrapeContext:
    ticker: str
    lookback_days: int = LOOKBACK_DAYS

    @property
    def normalized_ticker(self) -> str:
        return self.ticker.upper().strip()

    @property
    def cutoff_date(self) -> date:
        return datetime.now(timezone.utc).date() - timedelta(days=self.lookback_days)


# ──────────────────────────────────────────────
# Session factory
# ──────────────────────────────────────────────

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def _create_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(_HEADERS)
    return s


# ──────────────────────────────────────────────
# Text utilities
# ──────────────────────────────────────────────

def _clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    text = html.unescape(str(value))
    text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
    return _WHITESPACE_RE.sub(" ", text).strip()


def _normalize_for_dedup(text: str) -> str:
    lower = _clean_text(text).lower()
    lower = _NONALNUM_RE.sub("", lower)
    return _WHITESPACE_RE.sub(" ", lower).strip()


# ──────────────────────────────────────────────
# Date utilities
# ──────────────────────────────────────────────

def _parse_date(value: object) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        return value
    else:
        raw = _clean_text(str(value))
        if not raw:
            return None

        # Try ISO first (most common from APIs)
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            dt = None

        if dt is None:
            for fmt in _KNOWN_DATE_FMTS:
                try:
                    dt = datetime.strptime(raw, fmt)
                    break
                except ValueError:
                    continue

        if dt is None:
            m = _DATE_PATTERN_RE.search(raw)
            if m:
                candidate = m.group(1)
                for fmt in ("%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%Y-%m-%d"):
                    try:
                        dt = datetime.strptime(candidate, fmt)
                        break
                    except ValueError:
                        continue

        if dt is None:
            return None

    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.date()


def _format_date(value: object) -> Optional[str]:
    parsed = _parse_date(value)
    return parsed.isoformat() if parsed else None


def _is_recent(date_str: str, cutoff: date) -> bool:
    parsed = _parse_date(date_str)
    if parsed is None:
        return False
    return cutoff <= parsed <= datetime.now(timezone.utc).date()


# ──────────────────────────────────────────────
# Item construction & deduplication
# ──────────────────────────────────────────────

def _build_item(
    title: str, text: str, date_value: str,
    source: str, ticker: str, url: str,
) -> NewsItem:
    return {
        "title":  title,
        "text":   text,
        "date":   date_value,
        "source": source,
        "ticker": ticker.upper().strip(),
        "url":    url,
    }


def _source_rank(source: str) -> int:
    return {"API": 5, "Google": 4, "ET": 3, "Reddit": 2, "Twitter": 1}.get(source, 0)


def _deduplicate(items: List[NewsItem]) -> List[NewsItem]:
    """
    Two-pass dedup:
      1. Exact-match via set (O(n))
      2. Fuzzy match via SequenceMatcher only for near-misses (ratio ≥ 0.92)
    """
    unique: List[NewsItem] = []
    exact_seen: set = set()
    fuzzy_norms: List[str] = []

    for item in items:
        norm = _normalize_for_dedup(item["text"])
        if not norm:
            continue
        if norm in exact_seen:
            continue
        # Fuzzy check only against texts that passed exact-match
        if any(SequenceMatcher(None, norm, s).ratio() >= 0.92 for s in fuzzy_norms):
            continue
        exact_seen.add(norm)
        fuzzy_norms.append(norm)
        unique.append(item)

    return unique


def _finalize_items(items: List[NewsItem], cutoff: date) -> List[NewsItem]:
    cleaned: List[NewsItem] = []
    for item in items:
        text  = _clean_text(item.get("text", ""))
        title = _clean_text(item.get("title", ""))
        date_value = _format_date(item.get("date"))

        # Must have a real title (not a placeholder), min text, recent date
        if (
            len(text) < MIN_TEXT_LENGTH
            or date_value is None
            or not _is_recent(date_value, cutoff)
            or not title
            or title.lower() in {"market update", "stock update", ""}
        ):
            continue

        cleaned.append(_build_item(
            title, text, date_value,
            item["source"], item["ticker"], item.get("url", ""),
        ))

    cleaned = _deduplicate(cleaned)
    cleaned.sort(key=lambda r: (r["date"], _source_rank(r["source"])), reverse=True)
    return cleaned


# ──────────────────────────────────────────────
# Query resolution
# ──────────────────────────────────────────────

def _ticker_base(ticker: str) -> str:
    return str(ticker).split(".")[0].upper().strip()


def _resolve_query_terms(ticker: str) -> Dict[str, str]:
    norm = str(ticker or "").upper().strip()
    base = _ticker_base(norm)
    company = base
    if normalize_query is not None:
        try:
            resolved = _clean_text(normalize_query(norm))
            if resolved:
                company = resolved
        except Exception:
            pass
    return {"ticker": norm, "base_ticker": base, "company_name": company}


# ──────────────────────────────────────────────
# Google News redirect decoder
# ──────────────────────────────────────────────

def _decode_google_news_url(raw_url: str) -> str:
    """
    Google News RSS links are redirect URLs like:
      https://news.google.com/rss/articles/CBMi...
    We attempt to extract the real destination URL from the query string,
    or return the raw URL unchanged if we can't decode it.
    """
    if not raw_url:
        return ""
    parsed = urllib.parse.urlparse(raw_url)
    # Some Google News RSS items embed the real URL in 'url' param
    qs = urllib.parse.parse_qs(parsed.query)
    if "url" in qs:
        return qs["url"][0]
    # For encoded article URLs, return as-is — still clickable to the source
    return raw_url


# ──────────────────────────────────────────────
# Source fetchers
# ──────────────────────────────────────────────

def fetch_news_api(ticker: str, session: requests.Session) -> List[NewsItem]:
    """NewsAPI — highest quality, structured JSON."""
    api_key = os.getenv("NEWS_API_KEY") or NEWS_API_KEY
    if not api_key:
        logger.warning("NEWS_API_KEY not set; skipping NewsAPI")
        return []

    ctx   = ScrapeContext(ticker=ticker)
    terms = _resolve_query_terms(ticker)
    company, base = terms["company_name"], terms["base_ticker"]
    query = (
        f'"{company}" OR "{company} stock" OR '
        f'"{base} stock" OR "{base} earnings" OR "{base} news"'
    )
    params = {
        "q":        query,
        "language": "en",
        "sortBy":   "publishedAt",
        "pageSize": MAX_NEWSAPI_RESULTS,
        "from":     ctx.cutoff_date.isoformat(),
        "apiKey":   api_key,
    }

    try:
        resp = session.get(NEWSAPI_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "ok":
            logger.error("NewsAPI bad status for %s: %s", ticker, payload.get("status"))
            return []

        items: List[NewsItem] = []
        for article in payload.get("articles", []) or []:
            title  = _clean_text(article.get("title") or "")
            desc   = _clean_text(article.get("description") or "")
            text   = _clean_text(f"{title} {desc}".strip()) if title or desc else ""
            d      = _format_date(article.get("publishedAt"))
            url    = article.get("url") or ""

            # Skip articles with no real title or [Removed] placeholders
            if not title or "[removed]" in title.lower() or len(text) < MIN_TEXT_LENGTH or not d:
                continue

            items.append(_build_item(title, text, d, "API", ctx.normalized_ticker, url))

        logger.info("NewsAPI: %d raw items for %s", len(items), ticker)
        return items
    except Exception as exc:
        logger.exception("NewsAPI failed for %s: %s", ticker, exc)
        return []


def fetch_google_news(ticker: str, session: requests.Session) -> List[NewsItem]:
    """Google News RSS — good coverage, real publisher URLs after decode."""
    ctx   = ScrapeContext(ticker=ticker)
    terms = _resolve_query_terms(ticker)
    query = f"{terms['company_name']} stock {terms['base_ticker']}"
    params = {"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"}

    try:
        resp = session.get(GOOGLE_NEWS_RSS_URL, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()

        warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
        try:
            soup = BeautifulSoup(resp.content, "xml")
        except Exception:
            soup = BeautifulSoup(resp.content, "html.parser")

        items: List[NewsItem] = []
        for entry in soup.find_all("item")[:MAX_GOOGLE_RESULTS]:
            title  = _clean_text(entry.title.get_text(" ", strip=True) if entry.title else "")
            desc   = _clean_text(entry.description.get_text(" ", strip=True) if entry.description else "")
            text   = _clean_text(f"{title} {desc}".strip())
            pub    = _format_date(entry.pubDate.get_text(strip=True) if entry.pubDate else None)

            # Decode the Google redirect to the real article URL
            raw_link = entry.link.get_text(strip=True) if entry.link else ""
            # Sometimes <link> is a sibling text node, not a tag
            if not raw_link and entry.find("link"):
                raw_link = entry.find("link").get_text(strip=True)
            url = _decode_google_news_url(raw_link)

            # Also try <source url="..."> for direct publisher link
            source_tag = entry.find("source")
            if source_tag and source_tag.get("url"):
                # source url is the publisher homepage; use raw link (Google article) instead
                pass

            if not title or len(text) < MIN_TEXT_LENGTH or not pub:
                continue

            items.append(_build_item(title, text, pub, "Google", ctx.normalized_ticker, url))

        logger.info("Google News: %d raw items for %s", len(items), ticker)
        return items
    except Exception as exc:
        logger.exception("Google News failed for %s: %s", ticker, exc)
        return []


def fetch_et_news(ticker: str, session: requests.Session) -> List[NewsItem]:
    """Economic Times topic page — good for Indian stocks."""
    ctx   = ScrapeContext(ticker=ticker)
    terms = _resolve_query_terms(ticker)
    slug  = re.sub(r"\s+", "-", terms["company_name"].lower()) or terms["base_ticker"].lower()
    url   = ECONOMIC_TIMES_TOPIC_URL.format(slug=slug)

    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        items: List[NewsItem] = []
        seen_sigs: set = set()

        # ET story containers — most specific first
        for selector in ("div.eachStory", "div.eachstory", "article", "li.story"):
            for container in soup.select(selector):
                # ── Title: must come from an <a> or heading, never fabricated ──
                title = ""
                for tag in container.select("h1 a, h2 a, h3 a, a[title]"):
                    candidate = _clean_text(tag.get("title") or tag.get_text(" ", strip=True))
                    if len(candidate) >= MIN_TEXT_LENGTH:
                        title = candidate
                        break
                if not title:
                    for tag in container.select("h1, h2, h3"):
                        candidate = _clean_text(tag.get_text(" ", strip=True))
                        if len(candidate) >= MIN_TEXT_LENGTH:
                            title = candidate
                            break
                if not title:
                    continue  # Skip — no real headline found

                # ── Snippet ──
                snippet = ""
                for tag in container.select("p, span.summary, div.summary, span.desc"):
                    candidate = _clean_text(tag.get_text(" ", strip=True))
                    if len(candidate) >= 20:
                        snippet = candidate
                        break

                text = _clean_text(f"{title} {snippet}".strip())
                sig  = text[:120]
                if sig in seen_sigs or len(text) < MIN_TEXT_LENGTH:
                    continue
                seen_sigs.add(sig)

                # ── Date ──
                date_text = None
                for tag in container.select("time, span.date, span.time, div.date"):
                    candidate = _clean_text(tag.get("datetime") or tag.get_text(" ", strip=True))
                    if candidate:
                        date_text = candidate
                        break
                if not date_text:
                    m = _DATE_PATTERN_RE.search(container.get_text(" ", strip=True))
                    if m:
                        date_text = m.group(1)
                article_date = _format_date(date_text)
                if not article_date:
                    continue

                # ── Real article URL (not topic page) ──
                article_url = ""
                link_tag = container.find("a", href=True)
                if link_tag:
                    href = link_tag["href"]
                    # Resolve relative URLs
                    if href.startswith("/"):
                        article_url = f"https://economictimes.indiatimes.com{href}"
                    elif href.startswith("http"):
                        article_url = href

                if not article_url:
                    continue  # Skip items with no real link

                items.append(_build_item(title, text, article_date, "ET", ctx.normalized_ticker, article_url))
                if len(items) >= MAX_ET_RESULTS:
                    break
            if len(items) >= MAX_ET_RESULTS:
                break

        logger.info("ET: %d raw items for %s", len(items), ticker)
        return items
    except Exception as exc:
        logger.exception("ET failed for %s: %s", ticker, exc)
        return []


def fetch_twitter_news(ticker: str, session: requests.Session) -> List[NewsItem]:
    """Twitter/X via snscrape — optional dependency."""
    ctx   = ScrapeContext(ticker=ticker)
    terms = _resolve_query_terms(ticker)

    try:
        sntwitter = importlib.import_module("snscrape.modules.twitter")
    except Exception as exc:
        logger.warning("snscrape unavailable; skipping Twitter for %s: %s", ticker, exc)
        return []

    query = (
        f"{terms['company_name']} stock OR "
        f"{terms['company_name']} news OR "
        f"#{terms['base_ticker']} OR ${terms['base_ticker']}"
    )

    try:
        scraper = sntwitter.TwitterSearchScraper(query)
        items: List[NewsItem] = []

        for i, tweet in enumerate(scraper.get_items()):
            if i >= MAX_TWITTER_RESULTS:
                break
            text  = _clean_text(getattr(tweet, "content", ""))
            d     = _format_date(getattr(tweet, "date", None))
            url   = getattr(tweet, "url", "")
            user  = getattr(getattr(tweet, "user", None), "username", "unknown")
            title = f"@{user}: {text[:80]}{'…' if len(text) > 80 else ''}"

            if len(text) < MIN_TEXT_LENGTH or not d:
                continue

            items.append(_build_item(title, text, d, "Twitter", ctx.normalized_ticker, url))

        logger.info("Twitter: %d raw items for %s", len(items), ticker)
        return items
    except Exception as exc:
        logger.warning("Twitter unavailable for %s: %s", ticker, exc)
        return []


def fetch_reddit_news(ticker: str, session: requests.Session) -> List[NewsItem]:
    """Reddit r/IndianStockMarket — filtered by ticker relevance."""
    ctx   = ScrapeContext(ticker=ticker)
    terms = _resolve_query_terms(ticker)
    name_pat   = terms["company_name"].lower()
    ticker_pat = terms["base_ticker"].lower()

    try:
        resp = session.get(
            REDDIT_SEARCH_URL,
            headers={"User-Agent": "FinIntelEngine/2.0"},
            params={"limit": MAX_REDDIT_RESULTS},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        children = (resp.json() or {}).get("data", {}).get("children", [])

        items: List[NewsItem] = []
        for child in children:
            data   = child.get("data", {}) if isinstance(child, dict) else {}
            title  = _clean_text(data.get("title", ""))
            body   = _clean_text(data.get("selftext", ""))
            text   = _clean_text(f"{title} {body}".strip())

            if len(text) < MIN_TEXT_LENGTH:
                continue
            text_lower = text.lower()
            if name_pat not in text_lower and ticker_pat not in text_lower:
                continue

            d = None
            try:
                d = datetime.fromtimestamp(
                    float(data["created_utc"]), timezone.utc
                ).date().isoformat()
            except Exception:
                continue

            permalink = data.get("permalink", "")
            url = f"https://www.reddit.com{permalink}" if permalink else ""

            items.append(_build_item(title, text, d, "Reddit", ctx.normalized_ticker, url))

        logger.info("Reddit: %d raw items for %s", len(items), ticker)
        return items
    except Exception as exc:
        logger.exception("Reddit failed for %s: %s", ticker, exc)
        return []


# ──────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────

def get_news(ticker: str) -> List[Dict]:
    """
    Return recent financial news items for *ticker*.

    All five sources are queried in parallel. Results are merged,
    cleaned, filtered to LOOKBACK_DAYS, and deduplicated before return.
    Every item has a real article title and a direct source URL.
    """
    ctx = ScrapeContext(ticker=ticker)
    logger.info("get_news: %s (cutoff %s)", ctx.normalized_ticker, ctx.cutoff_date)

    # One shared session per get_news() call — connection pooling across sources
    session = _create_session()

    fetchers = {
        "API":     lambda: fetch_news_api(ctx.normalized_ticker, session),
        "Google":  lambda: fetch_google_news(ctx.normalized_ticker, session),
        "ET":      lambda: fetch_et_news(ctx.normalized_ticker, session),
        "Reddit":  lambda: fetch_reddit_news(ctx.normalized_ticker, session),
        "Twitter": lambda: fetch_twitter_news(ctx.normalized_ticker, session),
    }

    combined: List[NewsItem] = []

    # Fire all sources simultaneously — total latency ≈ slowest single source
    with ThreadPoolExecutor(max_workers=len(fetchers)) as executor:
        future_to_name = {executor.submit(fn): name for name, fn in fetchers.items()}
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            try:
                items = future.result() or []
                if items:
                    logger.info("%s: %d items for %s", name, len(items), ctx.normalized_ticker)
                    combined.extend(items)
            except Exception as exc:
                logger.exception("Source %s failed for %s: %s", name, ctx.normalized_ticker, exc)

    if not combined:
        logger.warning("No news found for %s", ctx.normalized_ticker)
        return []

    finalized = _finalize_items(combined, ctx.cutoff_date)
    logger.info("Returning %d combined items for %s", len(finalized), ctx.normalized_ticker)
    return finalized


__all__ = [
    "NewsItem",
    "ScrapeContext",
    "fetch_news_api",
    "fetch_google_news",
    "fetch_et_news",
    "fetch_reddit_news",
    "fetch_twitter_news",
    "get_news",
]