"""The cache table for Django's database cache (settings.CACHES). Every web worker shares it, so allauth's sign-in
rate limits count all attempts, not only the ones that reached one worker's memory."""
from django.core.management import call_command
from django.db import migrations


def create(apps, schema_editor):
    call_command("createcachetable", database=schema_editor.connection.alias, verbosity=0)


def drop(apps, schema_editor):
    schema_editor.execute("DROP TABLE IF EXISTS django_cache")


class Migration(migrations.Migration):
    atomic = False  # MySQL cannot run DDL (create or drop the table) inside a transaction
    dependencies = [("rental", "0031_backfill_money_events")]
    operations = [migrations.RunPython(create, drop)]
