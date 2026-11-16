"""How deeply a forum body nests markdown containers (spec 5 hostile-content limits).

Every viewer's browser parses forum markdown. A line like ``> > > … a`` (thousands of
markers) overflows the parser's stack, and ``- - - … a`` makes it quadratic, so bodies
whose lines nest more than ``FORUM_MAX_CONTAINER_NESTING`` containers are refused.
The frontend applies the same count (``maxContainerNesting`` in ``remarkCommunity.js``).
"""

_DIGITS = "0123456789"
_BULLETS = "-*+"
# CommonMark allows up to three spaces of indentation before a container marker.
_MAX_INDENT = 3
# Ordered-list numbers have at most nine digits.
_MAX_ORDER_DIGITS = 9


def _marker_end(line: str, index: int) -> int:
    """End of the container marker at ``index`` (a quote, bullet or ``1.``), or -1."""
    length = len(line)
    char = line[index] if index < length else ""
    if char == ">":
        return index + 1
    if char and char in _BULLETS:
        # A bullet only opens a list when a space, a tab or the line end follows it.
        follower = line[index + 1] if index + 1 < length else ""
        return index + 1 if follower in ("", " ", "\t") else -1
    end = index
    while end < length and end - index < _MAX_ORDER_DIGITS and line[end] in _DIGITS:
        end += 1
    if end == index or end >= length or line[end] not in ".)":
        return -1
    return end + 1


def _line_nesting(line: str) -> int:
    """Container markers at the start of ``line``; one forward pass."""
    count = 0
    index = 0
    length = len(line)
    while True:
        spaces = 0
        while index < length and line[index] == " " and spaces < _MAX_INDENT:
            index += 1
            spaces += 1
        end = _marker_end(line, index)
        if end == -1:
            return count
        count += 1
        index = end + 1 if end < length and line[end] in " \t" else end


def max_container_nesting(text: str) -> int:
    """The deepest per-line container nesting in ``text`` (linear in its length)."""
    return max((_line_nesting(line) for line in (text or "").split("\n")), default=0)
