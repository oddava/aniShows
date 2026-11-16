"""How deeply, and how much, a forum body nests markdown containers (hostile-content limits).

Every viewer's browser parses forum markdown. Deep nesting (``> > > … a``, or ``- - - …``
continued on indented lines) overflows the parser's stack or makes it quadratic, and parse
time grows with the total number of container markers. So a body is refused when a line
nests deeper than ``FORUM_MAX_CONTAINER_NESTING`` or the body has more than
``FORUM_MAX_CONTAINER_MARKERS`` markers. The frontend applies the same counts
(``containerStats`` in ``remarkCommunity.js``) and shows such text as plain text.

A line's depth is half its leading indentation in columns (a list level needs at least two
columns to continue) plus every container marker on it (``>``, a ``-``/``*``/``+`` bullet
followed by whitespace, ``1.``/``1)``), with any whitespace between markers. Fenced code is
counted too: guessing fences differently from the parser would open a bypass.
"""

from dataclasses import dataclass

_DIGITS = "0123456789"
_BULLETS = "-*+"
_WHITESPACE = " \t"
_TAB_STOP = 4
# Ordered-list numbers have at most nine digits.
_MAX_ORDER_DIGITS = 9


@dataclass(frozen=True, slots=True)
class ContainerStats:
    depth: int
    markers: int


def _marker_end(line: str, index: int) -> int:
    """End of the container marker at ``index`` (a quote, bullet or ``1.``), or -1."""
    length = len(line)
    char = line[index] if index < length else ""
    if char == ">":
        return index + 1
    if char and char in _BULLETS:
        # A bullet only opens a list when whitespace or the line end follows it.
        return index + 1 if index + 1 >= length or line[index + 1] in _WHITESPACE else -1
    end = index
    while end < length and end - index < _MAX_ORDER_DIGITS and line[end] in _DIGITS:
        end += 1
    if end == index or end >= length or line[end] not in ".)":
        return -1
    return end + 1


def _line_stats(line: str) -> ContainerStats:
    """Depth and marker count of one line; a single forward pass."""
    length = len(line)
    columns = index = 0
    while index < length and line[index] in _WHITESPACE:
        columns += _TAB_STOP - columns % _TAB_STOP if line[index] == "\t" else 1
        index += 1
    markers = 0
    while (end := _marker_end(line, index)) != -1:
        markers += 1
        index = end
        while index < length and line[index] in _WHITESPACE:
            index += 1
    return ContainerStats(depth=columns // 2 + markers, markers=markers)


def container_stats(text: str) -> ContainerStats:
    """The deepest line's nesting and the total container markers (linear in the length)."""
    depth = markers = 0
    for line in (text or "").split("\n"):
        stats = _line_stats(line)
        depth = max(depth, stats.depth)
        markers += stats.markers
    return ContainerStats(depth=depth, markers=markers)


def max_container_nesting(text: str) -> int:
    """The deepest per-line container nesting in ``text``."""
    return container_stats(text).depth
