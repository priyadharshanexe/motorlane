"""Database feature switches shared by the background jobs."""

from django.db import connection


def skip_locked():
    """SKIP LOCKED where the database has it (MySQL 8), so parallel workers pass over
    rows another worker holds. TiDB lacks it; a plain row lock is still correct there,
    it only makes a second worker wait instead of moving on."""
    return connection.features.has_select_for_update_skip_locked
