"""Plain-text previews of forum markdown for thread lists."""

import html
import re

import bleach

EXCERPT_MAX_LENGTH = 200
SPOILER_PLACEHOLDER = "[spoiler]"

_SPOILERS = re.compile(r"\|\|.*?\|\||>!.*?!<", re.DOTALL)
_CODE_FENCE_MARKERS = re.compile(r"^\s*(```|~~~)[^\n]*$", re.MULTILINE)
# ``@[title](url)`` embeds and ``![alt](url|width|align)`` images carry no text.
_EMBEDS = re.compile(r"(?:!|@)\[[^\]]*\]\([^)]*\)")
_LINKS = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_LINE_PREFIXES = re.compile(r"^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)", re.MULTILINE)
# A single ``_`` only at a word edge, so ``snake_case`` names survive.
_EMPHASIS = re.compile(r"\*\*|__|~~|`|\*|(?<!\w)_|_(?!\w)")
_WHITESPACE = re.compile(r"\s+")


def _strip_markdown(text: str) -> str:
    text = _SPOILERS.sub(f" {SPOILER_PLACEHOLDER} ", text)
    text = _CODE_FENCE_MARKERS.sub(" ", text)
    text = _EMBEDS.sub(" ", text)
    text = _LINKS.sub(r"\1", text)
    text = _LINE_PREFIXES.sub("", text)
    return _EMPHASIS.sub("", text)


def build_excerpt(content: str, max_length: int = EXCERPT_MAX_LENGTH) -> str:
    """Return ``content`` as one line of plain text, at most ``max_length`` characters.

    Markdown syntax and HTML tags are dropped, spoilers become ``[spoiler]``, and a
    cut text ends with an ellipsis (counted in the limit).
    """
    text = _strip_markdown(content or "")
    # Drop tags, then decode what bleach (and old rows) entity-encoded.
    text = html.unescape(bleach.clean(text, tags=[], strip=True))
    text = _WHITESPACE.sub(" ", text).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"
