"""How deeply, and how much, a forum body nests markdown containers (hostile-content limits).

Every viewer's browser parses forum markdown. Deep nesting (``> > > … a``, or ``- - - …``
continued on indented lines) overflows the parser's stack or makes it quadratic, and parse
time grows with the total number of container markers. So a body is refused when a line
nests deeper than ``FORUM_MAX_CONTAINER_NESTING`` or the body has more than
``FORUM_MAX_CONTAINER_MARKERS`` markers. The frontend applies the same counts
(``containerStats`` in ``remarkCommunity.js``), and parses long text under a time budget.

Lines end at LF, CRLF or a bare CR (the parser treats a bare CR as a line end too; the
serializers also normalise line endings before saving). On each line a marker run is container
markers separated only by whitespace: ``>``, a ``-``/``*``/``+`` bullet or a ``1.``/``1)`` number
followed by whitespace (or the line end), or a ``[^label]:`` footnote definition. A run may start
anywhere on the line (containers also open after footnote prefixes or alignment splits); a run at
the start of the line also counts half the indentation in columns (a list level needs at least
two columns to continue). Fenced code is counted too: guessing fences differently from the
parser would open a bypass.
"""

from dataclasses import dataclass

_DIGITS = "0123456789"
_BULLETS = "-*+"
_WHITESPACE = " \t"
_TAB_STOP = 4
# Ordered-list numbers have at most nine digits.
_MAX_ORDER_DIGITS = 9
# Longest footnote label looked at, which keeps the scan linear.
_MAX_FOOTNOTE_LABEL = 100


@dataclass(frozen=True, slots=True)
class ContainerStats:
    depth: int
    markers: int


def _followed_by_space(line: str, index: int) -> bool:
    return index >= len(line) or line[index] in _WHITESPACE


def _marker_end(line: str, index: int) -> int:
    """End of the container marker at ``index``, or -1."""
    length = len(line)
    char = line[index]
    if char == ">":
        return index + 1
    if char in _BULLETS:
        return index + 1 if _followed_by_space(line, index + 1) else -1
    if char in _DIGITS:
        end = index
        while end < length and end - index < _MAX_ORDER_DIGITS and line[end] in _DIGITS:
            end += 1
        ordered = end < length and line[end] in ".)"
        return end + 1 if ordered and _followed_by_space(line, end + 1) else -1
    if char == "[" and line.startswith("^", index + 1):
        limit = min(length, index + 2 + _MAX_FOOTNOTE_LABEL)
        end = index + 2
        while end < limit and line[end] != "]" and line[end] not in _WHITESPACE:
            end += 1
        definition = end > index + 2 and line.startswith("]:", end)
        return end + 2 if definition else -1
    return -1


def _marker_run(line: str, index: int) -> tuple[int, int]:
    """``(markers, end)`` of the marker run starting at ``index``."""
    length = len(line)
    markers = 0
    while index < length and (end := _marker_end(line, index)) != -1:
        markers += 1
        index = end
        while index < length and line[index] in _WHITESPACE:
            index += 1
    return markers, index


def _line_stats(line: str) -> ContainerStats:
    """Depth and marker count of one line; a single forward pass."""
    length = len(line)
    columns = index = 0
    while index < length and line[index] in _WHITESPACE:
        columns += _TAB_STOP - columns % _TAB_STOP if line[index] == "\t" else 1
        index += 1
    indent_depth = columns // 2
    depth, markers, at_line_start = indent_depth, 0, True
    while index < length:
        run, end = _marker_run(line, index)
        if run:
            markers += run
            depth = max(depth, run + (indent_depth if at_line_start else 0))
            index = end
        else:
            index += 1
        at_line_start = False
    return ContainerStats(depth=depth, markers=markers)


def normalize_line_endings(text: str) -> str:
    """CRLF and bare CR line endings become LF."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def container_stats(text: str) -> ContainerStats:
    """The deepest line's nesting and the total container markers (linear in the length)."""
    depth = markers = 0
    for line in normalize_line_endings(text or "").split("\n"):
        stats = _line_stats(line)
        depth = max(depth, stats.depth)
        markers += stats.markers
    return ContainerStats(depth=depth, markers=markers)


def max_container_nesting(text: str) -> int:
    """The deepest per-line container nesting in ``text``."""
    return container_stats(text).depth
