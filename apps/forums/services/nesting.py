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
followed by whitespace (or the line end), or a ``[^label]:`` footnote definition. Runs count where
the parser can open containers: at the start of the line (plus half the indentation in columns: a
list level needs at least two columns to continue), right after an alignment opener or closer
(``<p align=…>``, ``</p>``: the renderer splits the text there), or when the run starts with a
footnote definition. So ``hype >>>>> lol`` is just text. Fenced code is counted too: guessing
fences differently from the parser would open a bypass.

Alignment tags are found in the whole text, not line by line: the renderer's whitespace class matches line
breaks (``<p`` newline ``align="center">``) and it trims aligned content, Unicode spaces included,
so a run can start after a tag that began on an earlier line, or after a no-break space.
"""

import re
from dataclasses import dataclass

_DIGITS = "0123456789"
_BULLETS = "-*+"
_WHITESPACE = " \t"
_TAB_STOP = 4
# Ordered-list numbers have at most nine digits.
_MAX_ORDER_DIGITS = 9
# Longest footnote label the parser accepts (micromark: 999), which also keeps the scan linear.
_MAX_FOOTNOTE_LABEL = 999
# Where the renderer's splitAlignedBlocks cuts the text, so a container can open right after it.
# JavaScript's \s (what the renderer matches and trims) is Python's \s plus U+FEFF; matching that
# union over the whole text finds every cut, including tags split across lines.
_JS_SPACE = r"[\s\ufeff]"
_ALIGNMENT_TAG = re.compile(
    rf"""<(?:p|div){_JS_SPACE}+align=["'](?:left|center|right)["']{_JS_SPACE}*>"""
    rf"""|</(?:p|div){_JS_SPACE}*>""",
    re.IGNORECASE,
)
_LEADING_JS_SPACE = re.compile(rf"{_JS_SPACE}*")


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


def _segment_starts(text: str) -> list[int]:
    """Sorted offsets just after an alignment tag and any whitespace: where a segment starts.

    Skipping whitespace may cross line breaks; the offset then lands on a later line, whose own
    scan picks it up.
    """
    starts = []
    for match in _ALIGNMENT_TAG.finditer(text):
        skipped = _LEADING_JS_SPACE.match(text, match.end())
        starts.append(skipped.end() if skipped else match.end())
    return sorted(set(starts))


def _line_stats(line: str, starts: frozenset[int] = frozenset()) -> ContainerStats:
    """Depth and marker count of one line; a single forward pass.

    ``starts``: offsets on this line where an alignment split starts a segment.
    """
    length = len(line)
    columns = index = 0
    while index < length and line[index] in _WHITESPACE:
        columns += _TAB_STOP - columns % _TAB_STOP if line[index] == "\t" else 1
        index += 1
    indent_depth = columns // 2
    depth, markers, at_line_start = indent_depth, 0, True
    while index < length:
        opens_containers = at_line_start or index in starts or line.startswith("[^", index)
        run, end = _marker_run(line, index) if opens_containers else (0, index)
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
    text = normalize_line_endings(text or "")
    starts = _segment_starts(text) if "<" in text else []
    depth = markers = offset = cursor = 0
    for line in text.split("\n"):
        line_end = offset + len(line)
        line_starts = set()
        while cursor < len(starts) and starts[cursor] < line_end:
            if starts[cursor] >= offset:
                line_starts.add(starts[cursor] - offset)
            cursor += 1
        stats = _line_stats(line, frozenset(line_starts))
        depth = max(depth, stats.depth)
        markers += stats.markers
        offset = line_end + 1
    return ContainerStats(depth=depth, markers=markers)


def max_container_nesting(text: str) -> int:
    """The deepest per-line container nesting in ``text``."""
    return container_stats(text).depth
