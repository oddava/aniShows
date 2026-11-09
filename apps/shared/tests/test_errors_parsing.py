from django.test import SimpleTestCase

from apps.shared.errors import iter_exception_chain
from apps.shared.parsing import positive_int


class IterExceptionChainTests(SimpleTestCase):
    def test_single_exception(self):
        exc = ValueError("x")
        self.assertEqual(list(iter_exception_chain(exc)), [exc])

    def test_none_yields_nothing(self):
        self.assertEqual(list(iter_exception_chain(None)), [])

    def test_follows_cause_before_context(self):
        root = KeyError("root")
        context = OSError("context")
        try:
            try:
                raise context
            except OSError:
                raise RuntimeError("top") from root
        except RuntimeError as exc:
            top = exc
        # __cause__ wins over the implicit __context__.
        self.assertEqual(list(iter_exception_chain(top)), [top, root])

    def test_follows_implicit_context(self):
        try:
            try:
                raise OSError("inner")
            except OSError:
                raise RuntimeError("outer")
        except RuntimeError as exc:
            outer = exc
        chain = list(iter_exception_chain(outer))
        self.assertEqual([type(e) for e in chain], [RuntimeError, OSError])

    def test_stops_at_a_cycle(self):
        a = ValueError("a")
        b = ValueError("b")
        a.__cause__ = b
        b.__cause__ = a
        self.assertEqual(list(iter_exception_chain(a)), [a, b])


class PositiveIntTests(SimpleTestCase):
    def test_positive_values(self):
        self.assertEqual(positive_int(5), 5)
        self.assertEqual(positive_int("7"), 7)
        self.assertEqual(positive_int(" 12 "), 12)
        self.assertEqual(positive_int(3.9), 3)

    def test_non_positive_and_unparseable_values(self):
        for value in (0, -1, "0", "-3", "", "abc", "1.5", None, [], {}, 0.5):
            with self.subTest(value=value):
                self.assertIsNone(positive_int(value))

    def test_bools_are_ints_unless_disallowed(self):
        # Provider payload callers (relation links, Jikan) always accepted True as 1.
        self.assertEqual(positive_int(True), 1)
        self.assertIsNone(positive_int(False))
        # The notification WebSocket consumer rejects JSON booleans as IDs.
        self.assertIsNone(positive_int(True, allow_bool=False))
        self.assertEqual(positive_int(4, allow_bool=False), 4)
        self.assertEqual(positive_int("4", allow_bool=False), 4)
