from django.test import SimpleTestCase

from apps.shared.text import (
    DEFAULT_PROFILE_PRIMARY_COLOR,
    decode_escaped_html_entities,
    normalize_bio,
    normalize_primary_color,
)


class DecodeEscapedHtmlEntitiesTests(SimpleTestCase):
    def test_decodes_the_five_escaped_entities(self):
        self.assertEqual(
            decode_escaped_html_entities(
                "&lt;p class=&quot;a&quot;&gt;it&#39;s &amp; me&lt;/p&gt;"
            ),
            '<p class="a">it\'s & me</p>',
        )

    def test_decodes_one_level_only(self):
        # &amp; is decoded last, so a double-escaped entity stays escaped once.
        self.assertEqual(decode_escaped_html_entities("&amp;lt;b&amp;gt;"), "&lt;b&gt;")

    def test_leaves_other_entities_and_plain_text_alone(self):
        self.assertEqual(decode_escaped_html_entities("&nbsp;&#x27; plain"), "&nbsp;&#x27; plain")
        self.assertEqual(decode_escaped_html_entities(""), "")


class NormalizeBioTests(SimpleTestCase):
    def test_decodes_strings(self):
        self.assertEqual(normalize_bio("&lt;b&gt;hi&lt;/b&gt;"), "<b>hi</b>")

    def test_non_strings_pass_through(self):
        self.assertIsNone(normalize_bio(None))
        self.assertEqual(normalize_bio(5), 5)


class NormalizePrimaryColorTests(SimpleTestCase):
    def test_valid_colors_are_stripped_and_lowercased(self):
        self.assertEqual(normalize_primary_color(" #AABBCC "), "#aabbcc")
        self.assertEqual(normalize_primary_color("#8b5cf6"), "#8b5cf6")

    def test_invalid_values_fall_back_to_the_default(self):
        for value in (None, "", "#abc", "aabbcc", "#gggggg", "#aabbccdd", 0xAABBCC):
            with self.subTest(value=value):
                self.assertEqual(normalize_primary_color(value), DEFAULT_PROFILE_PRIMARY_COLOR)

    def test_default_can_be_overridden(self):
        self.assertEqual(normalize_primary_color("nope", default="#000000"), "#000000")
