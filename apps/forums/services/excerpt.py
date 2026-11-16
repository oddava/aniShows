"""Plain-text previews of forum markdown for thread lists.

Forum text is stored and shown as typed (no HTML is ever rendered), so the excerpt
drops markdown syntax only; a typed ``<b>`` stays visible text, as on the thread page.
Content is hostile: only its start is read, and spoiler masking is a linear scan.
"""

import re

EXCERPT_MAX_LENGTH = 200
SPOILER_PLACEHOLDER = "[spoiler]"
# The excerpt needs only the start of the text; this also bounds every regex below.
EXCERPT_SOURCE_LENGTH = 4_000
# Spoiler openers and their closers (``||x||`` in forums, ``>!x!<`` in reviews).
_SPOILER_CLOSERS = {"||": "||", ">!": "!<"}

# ``[ \t]`` (never ``\s``) and bounded classes: no pattern can rescan across lines.
_CODE_FENCE_MARKERS = re.compile(r"^[ \t]*(```|~~~)[^\n]*$", re.MULTILINE)
# ``@[title](url)`` embeds and ``![alt](url|width|align)`` images carry no text.
_EMBEDS = re.compile(r"(?:!|@)\[[^\]\n]{0,300}\]\([^)\n]{0,500}\)")
_LINKS = re.compile(r"\[([^\]\n]{0,300})\]\([^)\n]{0,500}\)")
_LINE_PREFIXES = re.compile(
    r"^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)", re.MULTILINE
)
# A single ``_`` only at a word edge, so ``snake_case`` names survive.
_EMPHASIS = re.compile(r"\*\*|__|~~|`|\*|(?<!\w)_|_(?!\w)")
_WHITESPACE = re.compile(r"\s+")


def _mask_spoilers(text: str) -> str:
    """Replace each spoiler with ``[spoiler]``; an unclosed opener hides the rest.

    Hiding everything after an unclosed opener is the safe choice: the text may be a
    spoiler whose closer lies past the slice the excerpt reads. One left-to-right pass:
    the next position of each opener is searched again only once the scan passes it.
    """
    parts: list[str] = []
    next_at = {opener: text.find(opener) for opener in _SPOILER_CLOSERS}
    cursor = 0
    while True:
        pending = [(at, opener) for opener, at in next_at.items() if at != -1]
        if not pending:
            parts.append(text[cursor:])
            break
        start, opener = min(pending)
        parts.append(text[cursor:start])
        parts.append(f" {SPOILER_PLACEHOLDER} ")
        end = text.find(_SPOILER_CLOSERS[opener], start + len(opener))
        if end == -1:
            break
        cursor = end + len(_SPOILER_CLOSERS[opener])
        for other, at in next_at.items():
            if at != -1 and at < cursor:
                next_at[other] = text.find(other, cursor)
    return "".join(parts)


def _strip_markdown(text: str) -> str:
    text = _mask_spoilers(text)
    text = _CODE_FENCE_MARKERS.sub(" ", text)
    text = _EMBEDS.sub(" ", text)
    text = _LINKS.sub(r"\1", text)
    text = _LINE_PREFIXES.sub("", text)
    return _EMPHASIS.sub("", text)


def build_excerpt(content: str, max_length: int = EXCERPT_MAX_LENGTH) -> str:
    """Return ``content`` as one line of plain text, at most ``max_length`` characters.

    Markdown syntax is dropped, spoilers become ``[spoiler]``, and a cut text ends with
    an ellipsis (counted in the limit).
    """
    text = _strip_markdown((content or "")[:EXCERPT_SOURCE_LENGTH])
    text = _WHITESPACE.sub(" ", text).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 1].rstrip() + "…"
