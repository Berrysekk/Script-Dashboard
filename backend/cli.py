"""Operator CLI. Runs outside the HTTP layer — invoke via ``docker exec``.

Usage:
    python -m backend.cli set-master-password           # prompts twice
    python -m backend.cli set-master-password --from-env MASTER_PASSWORD
    python -m backend.cli reset-password <username>     # prompts for new pw

The master password is never settable through the web UI. This module is the
only write path.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

import backend.db as _db
from backend.services import auth as auth_service


def _cmd_set_master(args: argparse.Namespace) -> int:
    if args.from_env:
        pw = os.environ.get(args.from_env)
        if not pw:
            print(f"Env var {args.from_env} is not set.", file=sys.stderr)
            return 1
    else:
        pw = getpass.getpass("New master password: ")
        if not pw:
            print("Master password must not be empty.", file=sys.stderr)
            return 1
        confirm = getpass.getpass("Confirm master password: ")
        if pw != confirm:
            print("Passwords do not match.", file=sys.stderr)
            return 1
    _db.DATA_DIR.mkdir(parents=True, exist_ok=True)
    auth_service.write_master_hash(pw)
    print(f"Master password written to {auth_service.master_hash_path()}")
    return 0


async def _reset_password_async(username: str, new_password: str) -> int:
    await _db.init_db()
    async with _db.get_db() as db:
        user = await auth_service.get_user_by_username(db, username)
        if not user:
            print(f"No such user: {username}", file=sys.stderr)
            return 1
        await auth_service.set_password(db, user["id"], new_password)
        await auth_service.delete_user_sessions(db, user["id"])
    print(f"Password reset for {username}.")
    return 0


def _cmd_reset_password(args: argparse.Namespace) -> int:
    new_pw = getpass.getpass(f"New password for {args.username}: ")
    if not new_pw:
        print("Password must not be empty.", file=sys.stderr)
        return 1
    confirm = getpass.getpass("Confirm new password: ")
    if new_pw != confirm:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    return asyncio.run(_reset_password_async(args.username, new_pw))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="backend.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_master = sub.add_parser("set-master-password", help="Set/rotate the master password.")
    p_master.add_argument(
        "--from-env",
        metavar="VAR",
        help="Read the new master password from this environment variable instead of prompting.",
    )
    p_master.set_defaults(func=_cmd_set_master)

    p_reset = sub.add_parser("reset-password", help="Directly reset a user password (break-glass).")
    p_reset.add_argument("username")
    p_reset.set_defaults(func=_cmd_reset_password)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
