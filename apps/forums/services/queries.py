from allauth.socialaccount.models import SocialAccount
from django.db.models import Count, Exists, OuterRef, Prefetch, Subquery

from apps.forums.models import Category, Post, PostLike, Thread, ThreadLike

_GOOGLE_ACCOUNTS_PREFETCH_AUTHOR = Prefetch(
    "author__socialaccount_set",
    queryset=SocialAccount.objects.filter(provider="google").only(
        "user_id", "provider", "extra_data"
    ),
    to_attr="_prefetched_social_accounts",
)


def build_category_queryset():
    latest_thread = Thread.objects.filter(category=OuterRef("pk")).order_by("-updated_at")
    return Category.objects.annotate(
        latest_thread_id=Subquery(latest_thread.values("id")[:1]),
        latest_thread_title=Subquery(latest_thread.values("title")[:1]),
        latest_thread_updated_at=Subquery(latest_thread.values("updated_at")[:1]),
        latest_thread_author_username=Subquery(latest_thread.values("author__username")[:1]),
    )


def build_thread_queryset(user):
    queryset = Thread.objects.select_related(
        "author", "author__userprofile", "category"
    ).prefetch_related("tags", _GOOGLE_ACCOUNTS_PREFETCH_AUTHOR)

    if user.is_authenticated:
        queryset = queryset.annotate(
            is_liked_by_user=Exists(ThreadLike.objects.filter(thread=OuterRef("pk"), user=user)),
        )

    return queryset


def build_post_queryset(user):
    queryset = Post.objects.select_related(
        "author", "author__userprofile", "thread"
    ).prefetch_related(_GOOGLE_ACCOUNTS_PREFETCH_AUTHOR).annotate(
        reply_count=Count("replies")
    )

    if user.is_authenticated:
        queryset = queryset.annotate(
            is_liked_by_user=Exists(PostLike.objects.filter(post=OuterRef("pk"), user=user))
        )

    return queryset


def get_threaded_posts_page(queryset, thread_id, top_level_posts):
    top_level_ids = [post.id for post in top_level_posts]
    all_descendant_ids = set()
    current_parent_ids = top_level_ids

    for _depth in range(10):
        if not current_parent_ids:
            break

        child_ids = list(
            queryset.filter(parent_id__in=current_parent_ids, thread_id=thread_id).values_list(
                "id", flat=True
            )
        )
        if not child_ids:
            break

        all_descendant_ids.update(child_ids)
        current_parent_ids = child_ids

    descendants = list(queryset.filter(id__in=all_descendant_ids)) if all_descendant_ids else []
    final_posts = list(top_level_posts) + descendants
    final_posts.sort(key=lambda post: post.created_at)
    return final_posts
