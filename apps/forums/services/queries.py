from collections import Counter

from allauth.socialaccount.models import SocialAccount
from django.db.models import (
    Count,
    Exists,
    IntegerField,
    OuterRef,
    Prefetch,
    Subquery,
    Value,
    prefetch_related_objects,
)
from django.db.models.functions import Coalesce

from ..models import Category, Post, PostLike, Thread, ThreadLike, ThreadSubscription

# Descendants returned with one page of top-level posts (or one ``?root=`` subtree).
MAX_DESCENDANTS_PER_PAGE = 300

_GOOGLE_ACCOUNTS_PREFETCH_AUTHOR = Prefetch(
    "author__socialaccount_set",
    queryset=SocialAccount.objects.filter(provider="google").only(
        "user_id", "provider", "extra_data"
    ),
    to_attr="_prefetched_social_accounts",
)


def build_category_queryset():
    latest_thread = Thread.objects.filter(category=OuterRef("pk"), is_removed=False).order_by(
        "-updated_at"
    )
    return Category.objects.annotate(
        latest_thread_id=Subquery(latest_thread.values("id")[:1]),
        latest_thread_title=Subquery(latest_thread.values("title")[:1]),
        latest_thread_updated_at=Subquery(latest_thread.values("updated_at")[:1]),
        latest_thread_author_username=Subquery(latest_thread.values("author__username")[:1]),
    )


def build_thread_queryset(user, *, include_removed: bool = False):
    """Threads with their author/category/tags loaded and the viewer's like/subscription state."""
    queryset = Thread.objects.select_related(
        "author", "author__userprofile", "category"
    ).prefetch_related("tags", _GOOGLE_ACCOUNTS_PREFETCH_AUTHOR)
    if not include_removed:
        queryset = queryset.filter(is_removed=False)

    if user.is_authenticated:
        queryset = queryset.annotate(
            is_liked_by_user=Exists(ThreadLike.objects.filter(thread=OuterRef("pk"), user=user)),
            is_subscribed=Exists(
                ThreadSubscription.objects.filter(thread=OuterRef("pk"), user=user)
            ),
        )

    return queryset


def _direct_reply_count():
    """Correlated count of a post's direct replies (no GROUP BY over the joined rows)."""
    replies = (
        Post.objects.filter(parent=OuterRef("pk"))
        .order_by()
        .values("parent")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return Coalesce(Subquery(replies, output_field=IntegerField()), Value(0))


def build_post_queryset(user, *, include_removed_threads: bool = False):
    queryset = (
        Post.objects.select_related("author", "author__userprofile", "thread")
        .prefetch_related(_GOOGLE_ACCOUNTS_PREFETCH_AUTHOR)
        .annotate(reply_count=_direct_reply_count())
    )
    if not include_removed_threads:
        queryset = queryset.filter(thread__is_removed=False)

    if user.is_authenticated:
        queryset = queryset.annotate(
            is_liked_by_user=Exists(PostLike.objects.filter(post=OuterRef("pk"), user=user))
        )

    return queryset


def _collect_descendants(queryset, thread_id: int, root_ids: list[int]) -> list[Post]:
    """Breadth-first descendants of ``root_ids``, at most ``MAX_DESCENDANTS_PER_PAGE``."""
    level_queryset = queryset.filter(thread_id=thread_id).prefetch_related(None)
    descendants: list[Post] = []
    frontier = root_ids
    for _level in range(Post.MAX_DEPTH):
        remaining = MAX_DESCENDANTS_PER_PAGE - len(descendants)
        if not frontier or remaining <= 0:
            break
        children = list(
            level_queryset.filter(parent_id__in=frontier).order_by("created_at", "id")[:remaining]
        )
        descendants.extend(children)
        frontier = [child.id for child in children if child.reply_count]
    if descendants:
        prefetch_related_objects(descendants, _GOOGLE_ACCOUNTS_PREFETCH_AUTHOR)
    return descendants


def _mark_hidden_replies(posts: list[Post]) -> None:
    """Flag posts some of whose direct replies were cut by the descendant cap."""
    returned_children = Counter(post.parent_id for post in posts if post.parent_id)
    for post in posts:
        # ``reply_count`` is annotated by ``build_post_queryset``.
        post.has_hidden_replies = returned_children[post.id] < post.reply_count  # type: ignore[attr-defined]


def get_threaded_posts_page(queryset, thread_id: int, top_level_posts: list[Post]) -> list[Post]:
    """One page of top-level posts plus their (capped) descendants, oldest first."""
    descendants = _collect_descendants(queryset, thread_id, [post.id for post in top_level_posts])
    posts = [*top_level_posts, *descendants]
    _mark_hidden_replies(posts)
    posts.sort(key=lambda post: (post.created_at, post.id))
    return posts


def get_post_subtree(queryset, thread_id: int, root: Post, children: list[Post]) -> list[Post]:
    """``root``, one page of its direct ``children`` and their (capped) descendants, oldest first.

    Paging the direct children keeps every reply reachable however wide the tree is:
    a root with more children than fit is continued on the next page.
    """
    descendants = _collect_descendants(queryset, thread_id, [child.id for child in children])
    posts = [root, *children, *descendants]
    _mark_hidden_replies(posts)
    posts.sort(key=lambda post: (post.created_at, post.id))
    return posts
