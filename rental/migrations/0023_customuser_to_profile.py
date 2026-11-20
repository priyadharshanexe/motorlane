"""Turn CustomUser into Profile: name and email now come from the auth user.

Data is preserved in three steps, before any column is dropped:

1. Every profile without an account gets one (unusable password, so the person can
   claim it through password reset), carrying the profile's name and email.
2. Linked accounts with an empty email or name inherit the profile's values, so the
   name shown to the other party and the address used for mail do not change.
3. The table is renamed in place (foreign keys keep pointing at the same rows), the
   account link becomes the required `user` field, and the duplicate columns go.

Reverse migration restores name and email from the auth user.
"""
import uuid

from django.conf import settings
from django.db import migrations, models
from django.db.models import deletion

PLACEHOLDER_DOMAIN = "@invalid.invalid"


def split_name(name):
    first, _, last = (name or "").strip().partition(" ")
    return first[:150], last[:150]


def move_identity_to_accounts(apps, schema_editor):
    Profile = apps.get_model("rental", "CustomUser")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    alias = schema_editor.connection.alias
    for profile in Profile.objects.using(alias).select_related("account").iterator():
        email = "" if profile.email.endswith(PLACEHOLDER_DOMAIN) else profile.email
        name = profile.name if profile.name and profile.name != profile.email else ""
        account = profile.account
        if account is None:
            first, last = split_name(name)
            account = User.objects.using(alias).create(
                username=f"rental-{uuid.uuid4().hex}", email=email, first_name=first, last_name=last, password="!",
            )
            profile.account = account
            profile.save(using=alias, update_fields=["account"])
            continue
        changed = []
        if not account.email and email:
            account.email = email
            changed.append("email")
        if not (account.first_name or account.last_name) and name and name not in (account.email, account.username):
            account.first_name, account.last_name = split_name(name)
            changed += ["first_name", "last_name"]
        if changed:
            account.save(using=alias, update_fields=changed)


def restore_identity_columns(apps, schema_editor):
    Profile = apps.get_model("rental", "CustomUser")
    alias = schema_editor.connection.alias
    for profile in Profile.objects.using(alias).select_related("account").iterator():
        account = profile.account
        profile.email = account.email or f"account-{account.pk}{PLACEHOLDER_DOMAIN}"
        profile.name = (f"{account.first_name} {account.last_name}".strip() or account.email or account.username)[:100]
        profile.save(using=alias, update_fields=["email", "name"])


class Migration(migrations.Migration):
    dependencies = [
        ("rental", "0022_review_and_price_constraints"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # Reversal needs the columns back with defaults before restore_identity_columns runs.
        migrations.AlterField(model_name="customuser", name="name", field=models.CharField(max_length=100, default="")),
        migrations.AlterField(model_name="customuser", name="email", field=models.EmailField(max_length=254, default="")),
        migrations.RunPython(move_identity_to_accounts, restore_identity_columns),
        migrations.RenameModel("CustomUser", "Profile"),
        migrations.RenameField("profile", "account", "user"),
        migrations.AlterField(
            model_name="profile", name="user",
            field=models.OneToOneField(on_delete=deletion.PROTECT, related_name="profile", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(model_name="profile", name="phone", field=models.CharField(blank=True, max_length=15)),
        migrations.RemoveField(model_name="profile", name="name"),
        migrations.RemoveField(model_name="profile", name="email"),
    ]
