"""``edited_at`` (P1-2), thread list excerpts (P1-5) and text stored as typed."""

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from ..services.excerpt import build_excerpt
from .conftest import make_reply


@pytest.mark.django_db
def test_editing_content_sets_edited_at_but_a_reply_or_a_no_op_does_not(
    make_user, make_thread, api_for
):
    author = make_user()
    thread = make_thread(author)
    client = api_for(author)
    thread_url = reverse("forums:thread-detail", args=[thread.id])

    client.post(reverse("forums:post-list"), {"thread": thread.id, "content": "r"}, format="json")
    same = client.patch(thread_url, {"title": "Thread", "content": "Body"}, format="json")
    assert same.data["edited_at"] is None

    edited = client.patch(thread_url, {"content": "Body, edited"}, format="json")
    assert edited.data["edited_at"] is not None


@pytest.mark.django_db
def test_editing_a_post_sets_edited_at(make_user, make_thread, api_for):
    author = make_user()
    post = make_reply(make_thread(author), author, content="first")
    url = reverse("forums:post-detail", args=[post.id])

    assert api_for(author).patch(url, {"content": "first"}, format="json").data["edited_at"] is None
    assert api_for(author).patch(url, {"content": "second"}, format="json").data["edited_at"]


@pytest.mark.django_db
def test_thread_list_has_an_excerpt_instead_of_content(make_user, make_thread):
    make_thread(make_user(), content="# Title\n\n**Big** news ||Spoiler text|| [link](https://x.y)")

    item = APIClient().get(reverse("forums:thread-list")).data["results"][0]

    assert "content" not in item
    assert item["excerpt"] == "Title Big news [spoiler] link"


@pytest.mark.django_db
def test_content_is_stored_as_typed(make_user, make_thread, api_for):
    author = make_user()
    thread = make_thread(author)
    typed = "if (a < b && c > d) {}\n> quote"

    response = api_for(author).post(
        reverse("forums:post-list"), {"thread": thread.id, "content": typed}, format="json"
    )

    assert response.data["content"] == typed
    assert thread.posts.get().content == typed


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("plain", "plain"),
        ("a >!hidden!< b", "a [spoiler] b"),
        ("![img](https://x/y.png|200|C) @[clip](https://youtu.be/x) text", "text"),
        ("```js\nlet a = 1 < 2;\n```", "let a = 1 < 2;"),
        # Text is shown as typed: tags and entities stay visible text.
        ("<b>bold</b> &amp; snake_case", "<b>bold</b> &amp; snake_case"),
        ("- one\n- two\n1. three", "one two three"),
    ],
)
def test_build_excerpt(content, expected):
    assert build_excerpt(content) == expected


def test_build_excerpt_is_at_most_200_characters():
    excerpt = build_excerpt("word " * 100)

    assert len(excerpt) <= 200
    assert excerpt.endswith("…")
