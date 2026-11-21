"""HTML part for the account emails that carry one link (verify, reset, confirm).

One simple branded layout: the AniShows wordmark, a heading, a few lines and
one big button, with the link also written out for clients that block buttons.
All CSS is inline (the ``<style>`` block only adds a dark variant for clients
that support ``prefers-color-scheme``); the button is lime with near-black text,
which reads the same on light and dark backgrounds and survives colour
inversion. The plain-text part stays the main body; this is its alternative.
"""

from __future__ import annotations

from django.utils.html import format_html, format_html_join

BRAND = "AniShows"

# Same values as the site's design tokens (frontend/src/index.css).
_SIGNATURE = "#d4f65a"  # --signature
_ON_SIGNATURE = "#0f1208"  # --on-signature
_INK = "#0b0d10"  # --ink-0
_INK_CARD = "#121519"  # --ink-1
_TEXT = "#18181b"
_MUTED = "#52525b"
_PAGE = "#f4f4f5"
_CARD = "#ffffff"

_DARK_STYLE = (
    "@media (prefers-color-scheme: dark) {"
    f" .as-page {{ background:{_INK} !important; }}"
    f" .as-card {{ background:{_INK_CARD} !important; border-color:#29303a !important; }}"
    " .as-text { color:#e4e4e7 !important; }"
    " .as-muted { color:#a1a1aa !important; }"
    f" .as-link {{ color:{_SIGNATURE} !important; }}"
    "}"
)


def action_email_html(
    *,
    heading: str,
    lines: list[str],
    button_label: str,
    button_url: str,
    notes: list[str],
) -> str:
    """Render the HTML alternative. Every argument is escaped."""
    body_lines = format_html_join(
        "",
        '<p class="as-text" style="margin:0 0 14px;color:{};font-size:16px;line-height:1.55;">'
        "{}</p>",
        ((_TEXT, line) for line in lines),
    )
    note_lines = format_html_join(
        "",
        '<p class="as-muted" style="margin:0 0 10px;color:{};font-size:14px;line-height:1.5;">'
        "{}</p>",
        ((_MUTED, note) for note in notes),
    )
    html = format_html(
        "<!doctype html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        "<title>{heading}</title><style>{dark_style}</style></head>"
        '<body class="as-page" style="margin:0;padding:0;background:{page};">'
        '<table role="presentation" class="as-page" width="100%" cellpadding="0" cellspacing="0" '
        'border="0" bgcolor="{page}" style="background:{page};">'
        '<tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="max-width:520px;">'
        '<tr><td style="padding:0 4px 16px;font-family:Arial,Helvetica,sans-serif;'
        'font-size:20px;font-weight:bold;">'
        '<span style="display:inline-block;background:{signature};color:{on_signature};'
        'padding:4px 10px;border-radius:6px;">{brand}</span></td></tr>'
        '<tr><td class="as-card" bgcolor="{card}" style="background:{card};'
        "border:1px solid #e4e4e7;border-radius:12px;padding:28px 24px;"
        'font-family:Arial,Helvetica,sans-serif;">'
        '<h1 class="as-text" style="margin:0 0 16px;color:{text};font-size:22px;'
        'line-height:1.3;">{heading}</h1>'
        "{body_lines}"
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:24px 0;"><tr>'
        '<td bgcolor="{signature}" style="background:{signature};border-radius:10px;">'
        '<a href="{button_url}" style="display:inline-block;padding:15px 30px;'
        "font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;"
        'color:{on_signature};text-decoration:none;border-radius:10px;">{button_label}</a>'
        "</td></tr></table>"
        "{note_lines}"
        '<p class="as-muted" style="margin:18px 0 0;color:{muted};font-size:13px;'
        'line-height:1.5;word-break:break-all;">If the button does not work, paste this '
        'link into your browser:<br><a class="as-link" href="{button_url}" '
        'style="color:#3f6212;">{button_url}</a></p>'
        "</td></tr>"
        '<tr><td class="as-muted" style="padding:16px 4px 0;color:{muted};'
        'font-family:Arial,Helvetica,sans-serif;font-size:12px;">'
        "Sent by {brand} because someone used this address on the site.</td></tr>"
        "</table></td></tr></table></body></html>",
        heading=heading,
        dark_style=_DARK_STYLE,
        page=_PAGE,
        card=_CARD,
        text=_TEXT,
        muted=_MUTED,
        signature=_SIGNATURE,
        on_signature=_ON_SIGNATURE,
        brand=BRAND,
        body_lines=body_lines,
        note_lines=note_lines,
        button_url=button_url,
        button_label=button_label,
    )
    return str(html)
