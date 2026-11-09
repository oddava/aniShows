from unittest.mock import patch

from celery import shared_task
from celery._state import _task_stack
from celery.exceptions import Retry
from django.core.cache import cache
from django.test import SimpleTestCase

from ..tasks.base import run_async_in_task
from ..tasks.watch_episodes import sync_watch_episodes_for_anime


@shared_task(bind=True, name="tests.animes.retry_from_coroutine", max_retries=3)
def _retry_from_coroutine(self):
    seen = {}

    async def work():
        seen["task_id"] = self.request.id
        raise self.retry(exc=ValueError("provider down"), countdown=60)

    try:
        run_async_in_task(work())
    finally:
        _retry_from_coroutine.seen = seen


class RunAsyncInTaskTests(SimpleTestCase):
    def test_coroutine_sees_the_task_request_and_can_schedule_a_retry(self):
        # What the worker's tracer sets up around a task run.
        _task_stack.push(_retry_from_coroutine)
        _retry_from_coroutine.push_request(id="task-1", called_directly=False, retries=0)
        try:
            with (
                patch("celery.canvas.Signature.apply_async") as send,
                self.assertRaises(Retry),
            ):
                _retry_from_coroutine.run()
        finally:
            _retry_from_coroutine.pop_request()
            _task_stack.pop()

        self.assertEqual(_retry_from_coroutine.seen["task_id"], "task-1")
        send.assert_called_once()


class TaskDeduplicationTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_duplicate_enqueue_is_skipped_but_a_retry_is_sent(self):
        with patch("celery.app.task.Task.apply_async") as send:
            sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": 7})
            sync_watch_episodes_for_anime.apply_async(kwargs={"anime_id": 7})
            sync_watch_episodes_for_anime.apply_async(
                kwargs={"anime_id": 7}, task_id="first", retries=1
            )

        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args.kwargs["retries"], 1)
