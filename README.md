# Script-Dashboard
A simple dashboard for managing multiple python scripts with loop function, logging and output management included

## Authentication

The dashboard requires login. On first start it bootstraps an admin account
and a recovery *master password*.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Username of the first admin account. |
| `ADMIN_PASSWORD` | *generated* | Password for the first admin. If unset, one is generated on first start and printed once to the container logs — copy it. |
| `MASTER_PASSWORD` | *generated* | Shared secret that lets any user reset their own password via the "Forgot password?" flow on the login page. If unset, one is generated and printed once. Record it offline. |

Both bootstrap values are consumed only on first start (when the users table
is empty / no master-password hash file exists). Subsequent starts ignore
them; rotate via the UI or the CLI below.

### User management

Admins manage users at `/users` in the web UI.

### Recovering a lost password

Use the **Forgot password?** link on the login page. Enter your username,
the master password, and a new password. The master password is a root-
equivalent shared secret — treat it like one.

### Rotating the master password

The master password is deliberately **not** settable via any HTTP endpoint.
To rotate it, open a shell inside the container and run the CLI:

```sh
docker exec -it script-dashboard python -m backend.cli set-master-password
```

It prompts twice and rewrites `/data/master_password.hash`. No web request
can replace this value, so compromising the dashboard can't replace your
recovery secret.

If all admins are locked out and no-one knows the master password, you can
also reset an individual user directly from the same CLI:

```sh
docker exec -it script-dashboard python -m backend.cli reset-password admin
```
