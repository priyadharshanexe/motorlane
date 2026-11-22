# Deploying Motorlane

This guide puts Motorlane on a single Linux server with Docker: MySQL, Django (Gunicorn),
the scheduler and Caddy, which obtains HTTPS certificates automatically. The same stack
runs either as a **public portfolio demo** (demo accounts, demo payments, reset daily)
or as a real deployment with Razorpay test mode.

You create and pay for any hosting account yourself. Nothing in this repository signs up
for a service, and no credentials are stored in it.

## What you need

- A small Linux VM (1 vCPU and 2 GB RAM are enough) with Docker Engine and the Compose
  plugin. Any provider works: a VPS from DigitalOcean, Hetzner, Linode, AWS Lightsail and
  so on, or your own machine with ports 80 and 443 reachable.
- A domain or subdomain whose DNS **A** (and optionally **AAAA**) record points at the
  server's public IP. Caddy cannot issue a certificate until DNS resolves.
- Inbound ports 80 and 443 open (TCP, and UDP 443 for HTTP/3).

## 1. Get the code and configure it

```sh
git clone https://github.com/priyadharshanexe/motorlane.git
cd motorlane
cp deploy/.env.production.example deploy/.env.production
```

Edit `deploy/.env.production`:

| Setting | Value |
| --- | --- |
| `DOMAIN`, `DJANGO_ALLOWED_HOSTS`, `SITE_URL` | Your hostname (keep `127.0.0.1,localhost` in the allowed hosts for health checks). |
| `DJANGO_SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `MYSQL_PASSWORD` | A long random password. The database is not exposed outside Docker. |
| `RENTAL_DEMO_PASSWORD` | For a demo: the password visitors use for the demo accounts (12+ characters). |

`deploy/.env.production` is git-ignored. Keep it out of commits and screenshots.

### Demo or real payments

- **Portfolio demo** (default in the template): `DJANGO_DEMO_MODE=1`, `PAYMENT_PROVIDER=fake`.
  No money moves; the UI labels payments "Demo payment, no real money". With
  `DEMO_DAILY_RESET=1` the scheduler wipes everything visitors created and re-seeds the demo
  data once a day at `DEMO_RESET_HOUR`. Email stays on the console backend.
- **Razorpay test mode**: set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID` (an
  `rzp_test_...` key), `RAZORPAY_KEY_SECRET` and `PAYMENT_WEBHOOK_SECRET` from the Razorpay
  dashboard in test mode. Live keys are refused. Point the Razorpay webhook at
  `https://<DOMAIN>/api/v1/payments/webhook/` with the same secret.

`manage.py check --deploy` runs before the server starts and refuses unsafe combinations
(for example the fake provider without demo mode), so a misconfigured deployment fails
fast instead of faking payments.

## 2. Start it

```sh
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env.production up -d --build
docker compose -f deploy/compose.prod.yaml --env-file deploy/.env.production ps
```

On start the web container checks settings, applies migrations and, for a demo with an
empty database, seeds the demo data. Caddy requests the certificate on first use.

Check it:

```sh
curl https://<DOMAIN>/healthz   # {"status": "ok"}
curl https://<DOMAIN>/readyz    # database and migrations
```

Then open `https://<DOMAIN>/app/` and `https://<DOMAIN>/api/docs`.

## 3. Operate it

| Task | Command (prefix with `docker compose -f deploy/compose.prod.yaml --env-file deploy/.env.production`) |
| --- | --- |
| Logs (JSON lines) | `logs -f web scheduler caddy` |
| Update to the latest code | `git pull` then `up -d --build` (migrations run on start) |
| Back up the database | `exec db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --no-tablespaces --single-transaction -u "$MYSQL_USER" "$MYSQL_DATABASE"' > backup.sql` |
| Reset the demo now | `exec scheduler python manage.py reset_demo` |
| Create an admin user | `exec web python manage.py createsuperuser` |
| Run a scheduler job by hand | `exec scheduler python manage.py run_scheduled_jobs` |

Uploaded photos live in the `media` volume and are served by Caddy; the database lives
in `mysql-data`. Back up both volumes for a real deployment.

## Before inviting real users

The demo configuration is for showing the project. For real users you would also want SMTP
email (`DJANGO_EMAIL_*`), regular off-server database backups, monitoring on `/readyz`, and
a real payment provider account with its own compliance requirements. Motorlane never
processes live payments as shipped.
