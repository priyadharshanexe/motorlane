from django.db import migrations


def add_mysql_constraints(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    columns = [
        "ADD COLUMN rental_primary_user BIGINT"
        " GENERATED ALWAYS AS (CASE WHEN `primary` THEN user_id END) {kind}",
        "ADD COLUMN rental_verified_email VARCHAR(254)"
        " GENERATED ALWAYS AS (CASE WHEN verified THEN email END) {kind}",
    ]
    indexes = [
        "ADD UNIQUE INDEX rental_unique_primary_email (rental_primary_user)",
        "ADD UNIQUE INDEX rental_unique_verified_email (rental_verified_email)",
    ]
    if "TiDB" in schema_editor.connection.mysql_server_info:
        # TiDB (MySQL-compatible, used by the hosted demo) cannot ADD a STORED
        # generated column, nor index a column added in the same statement. A
        # VIRTUAL column backs the same unique indexes.
        for clause in [c.format(kind="VIRTUAL") for c in columns] + indexes:
            schema_editor.execute(f"ALTER TABLE account_emailaddress {clause}")
        return
    schema_editor.execute(
        "ALTER TABLE account_emailaddress "
        + ", ".join([c.format(kind="STORED") for c in columns] + indexes)
    )


def remove_mysql_constraints(apps, schema_editor):
    if schema_editor.connection.vendor != "mysql":
        return
    schema_editor.execute("""
        ALTER TABLE account_emailaddress
        DROP INDEX rental_unique_primary_email,
        DROP INDEX rental_unique_verified_email,
        DROP COLUMN rental_primary_user,
        DROP COLUMN rental_verified_email
    """)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("account", "0009_emailaddress_unique_primary_email"),
        ("rental", "0010_link_django_accounts"),
    ]

    operations = [
        migrations.RunPython(add_mysql_constraints, remove_mysql_constraints),
    ]
