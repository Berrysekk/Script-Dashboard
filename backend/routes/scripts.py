import os
import uuid, json, zipfile, io, shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
import backend.db as _db
from backend.db import get_db
from backend.deps import current_user, require_admin
from backend.models import ScriptUpdateRequest, LoopRequest, CodeUpdateRequest, RequirementsUpdateRequest, SwapRequest, SetCategoryRequest, ScriptVariableRequest, ScriptVariablesBulkRequest, ScriptDatabasesUpdateRequest
from backend.services import databases as dbs

router = APIRouter()

# ── Upload / input limits ──────────────────────────────────────────────────
# Cap at 50 MiB by default; override with SCRIPT_MAX_UPLOAD_BYTES. These caps
# are the last line of defence against a logged-in user exhausting the disk.
MAX_UPLOAD_BYTES = int(os.environ.get("SCRIPT_MAX_UPLOAD_BYTES", 50 * 1024 * 1024))
MAX_NAME_LEN = 255
MAX_DESCRIPTION_LEN = 10_000
MAX_CODE_BYTES = 2 * 1024 * 1024  # 2 MiB of editable source is plenty
MAX_REQUIREMENTS_BYTES = 64 * 1024
# Zip-bomb guard: refuse archives whose decompressed py file exceeds this.
MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024


def _validate_metadata(name: Optional[str], description: Optional[str]) -> None:
    if name is not None and len(name) > MAX_NAME_LEN:
        raise HTTPException(400, f"Name exceeds {MAX_NAME_LEN} characters")
    if description is not None and len(description) > MAX_DESCRIPTION_LEN:
        raise HTTPException(400, f"Description exceeds {MAX_DESCRIPTION_LEN} characters")


def _safe_zip_name(name: str) -> bool:
    """Return True if a zip entry name is safe to reference.

    Rejects absolute paths, parent-traversal, NUL bytes, and backslashes (which
    some archivers emit and some extractors treat as separators).
    """
    if not name or "\x00" in name or "\\" in name:
        return False
    if name.startswith("/"):
        return False
    parts = name.split("/")
    return ".." not in parts


def _row_to_meta(row) -> dict:
    keys = row.keys()
    cat_id = row["category_id"] if "category_id" in keys else None
    cat_name = row["category_name"] if "category_name" in keys else None
    return {
        "id":            row["id"],
        "name":          row["name"],
        "filename":      row["filename"],
        "description":   row["description"],
        "loop_enabled":  bool(row["loop_enabled"]),
        "loop_interval": row["loop_interval"],
        "created_at":    row["created_at"],
        "owner_id":      row["owner_id"] if "owner_id" in keys else None,
        "status":        row["status"]       if "status"       in keys else None,
        "last_run_at":   row["last_run_at"]  if "last_run_at"  in keys else None,
        "run_count":     row["run_count"]    if "run_count"    in keys else 0,
        "position":      row["position"]     if "position"     in keys else 0,
        "category":      {"id": cat_id, "name": cat_name} if cat_id else None,
    }


def _can_see(user, row) -> bool:
    """Admins see everything; regular users only see scripts they own."""
    if user["role"] == "admin":
        return True
    return row["owner_id"] == user["id"]


async def _assert_can_access(db, script_id: str, user) -> None:
    """404 if the script doesn't exist *or* the user isn't allowed to touch it.

    We deliberately return 404 (not 403) to avoid leaking which IDs exist.
    """
    cur = await db.execute("SELECT id, owner_id FROM scripts WHERE id = ?", (script_id,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Script not found")
    if user["role"] == "admin":
        return
    if row["owner_id"] == user["id"]:
        return
    # Check role-based access
    cur2 = await db.execute(
        "SELECT 1 FROM role_scripts WHERE role_name = ? AND script_id = ?",
        (user["role"], script_id),
    )
    if await cur2.fetchone():
        return
    # Check category-based access
    from backend.services import categories as cat_service
    accessible = await cat_service.get_scripts_accessible_via_categories(db, user["role"])
    if script_id in accessible:
        return
    raise HTTPException(404, "Script not found")


@router.post("/scripts")
async def upload_script(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    user=Depends(current_user),
):
    _validate_metadata(name, description)

    # Stream the upload in chunks so an attacker can't exhaust memory by
    # sending a 10 GB body — we reject as soon as the cap is exceeded.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"Upload exceeds {MAX_UPLOAD_BYTES} bytes")
        chunks.append(chunk)
    content = b"".join(chunks)

    script_id  = str(uuid.uuid4())
    script_dir  = _db.SCRIPTS_DIR / script_id
    script_dir.mkdir(parents=True, exist_ok=True)
    (script_dir / "output").mkdir(exist_ok=True)

    filename = file.filename or "script.py"

    if filename.endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                names = zf.namelist()
                # Reject traversal / absolute paths in zip entries.
                if not all(_safe_zip_name(n) for n in names):
                    raise HTTPException(400, "zip contains unsafe entry names")
                py_files = [n for n in names if n.endswith(".py")]
                if not py_files:
                    raise HTTPException(400, "zip must contain a .py file")
                # Zip-bomb guard based on declared uncompressed size.
                info = zf.getinfo(py_files[0])
                if info.file_size > MAX_UNCOMPRESSED_BYTES:
                    raise HTTPException(400, "zip entry too large")
                data = zf.read(py_files[0])
                if len(data) > MAX_UNCOMPRESSED_BYTES:
                    raise HTTPException(400, "zip entry too large")
                (script_dir / "script.py").write_bytes(data)
                if "requirements.txt" in names:
                    req_info = zf.getinfo("requirements.txt")
                    if req_info.file_size > MAX_REQUIREMENTS_BYTES:
                        raise HTTPException(400, "requirements.txt too large")
                    (script_dir / "requirements.txt").write_bytes(
                        zf.read("requirements.txt")
                    )
        except zipfile.BadZipFile:
            shutil.rmtree(script_dir, ignore_errors=True)
            raise HTTPException(400, "Invalid zip file")
        filename = Path(py_files[0]).name
    else:
        (script_dir / "script.py").write_bytes(content)

    display_name = name or Path(filename).stem
    meta = {
        "id": script_id, "name": display_name, "filename": filename,
        "description": description, "loop_enabled": False,
        "loop_interval": None, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (script_dir / "meta.json").write_text(json.dumps(meta))

    async with get_db() as db:
        await db.execute(
            "INSERT INTO scripts (id, name, filename, description, owner_id) VALUES (?, ?, ?, ?, ?)",
            (script_id, display_name, filename, description, user["id"]),
        )
        await db.commit()

    return {
        **meta,
        "owner_id": user["id"],
        "status": "idle",
        "last_run_at": None,
        "run_count": 0,
    }


@router.get("/scripts")
async def list_scripts(user=Depends(current_user)):
    from backend.services import categories as cat_service
    base_sql = """
        SELECT s.*, c.name AS category_name,
               r.status,
               r.started_at AS last_run_at,
               (SELECT COUNT(*) FROM runs WHERE script_id = s.id) AS run_count
        FROM scripts s
        LEFT JOIN categories c ON c.id = s.category_id
        LEFT JOIN runs r ON r.id = (
            SELECT id FROM runs WHERE script_id = s.id
            ORDER BY started_at DESC LIMIT 1
        )
    """
    async with get_db() as db:
        if user["role"] == "admin":
            cur = await db.execute(base_sql + " ORDER BY s.position ASC, s.created_at DESC")
        else:
            cat_script_ids = await cat_service.get_scripts_accessible_via_categories(db, user["role"])
            if cat_script_ids:
                placeholders = ",".join("?" for _ in cat_script_ids)
                cur = await db.execute(
                    base_sql + f"""
                    WHERE s.owner_id = ?
                       OR s.id IN (SELECT script_id FROM role_scripts WHERE role_name = ?)
                       OR s.id IN ({placeholders})
                    ORDER BY s.position ASC, s.created_at DESC
                    """,
                    (user["id"], user["role"], *cat_script_ids),
                )
            else:
                cur = await db.execute(
                    base_sql + """
                    WHERE s.owner_id = ?
                       OR s.id IN (SELECT script_id FROM role_scripts WHERE role_name = ?)
                    ORDER BY s.position ASC, s.created_at DESC
                    """,
                    (user["id"], user["role"]),
                )
        rows = await cur.fetchall()
        return [_row_to_meta(r) for r in rows]


@router.get("/scripts/{script_id}")
async def get_script(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        cur = await db.execute("""
            SELECT s.*, c.name AS category_name,
                   r.status,
                   r.started_at AS last_run_at,
                   (SELECT COUNT(*) FROM runs WHERE script_id = s.id) AS run_count
            FROM scripts s
            LEFT JOIN categories c ON c.id = s.category_id
            LEFT JOIN runs r ON r.id = (
                SELECT id FROM runs WHERE script_id = s.id
                ORDER BY started_at DESC LIMIT 1
            )
            WHERE s.id = ?
        """, (script_id,))
        row = await cur.fetchone()
        cur = await db.execute(
            "SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC",
            (script_id,),
        )
        runs = [dict(r) for r in await cur.fetchall()]
    return {**_row_to_meta(row), "runs": runs}


@router.patch("/scripts/{script_id}")
async def patch_script(script_id: str, body: ScriptUpdateRequest, user=Depends(current_user)):
    _validate_metadata(body.name, body.description)
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        if body.name is not None:
            await db.execute("UPDATE scripts SET name=? WHERE id=?", (body.name, script_id))
        if body.description is not None:
            await db.execute("UPDATE scripts SET description=? WHERE id=?", (body.description, script_id))
        if body.loop_interval is not None:
            await db.execute("UPDATE scripts SET loop_interval=? WHERE id=?", (body.loop_interval, script_id))
        if body.loop_enabled is not None:
            await db.execute("UPDATE scripts SET loop_enabled=? WHERE id=?", (int(body.loop_enabled), script_id))
        await db.commit()
    return await get_script(script_id, user)


@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        await db.execute("DELETE FROM runs WHERE script_id = ?", (script_id,))
        await db.execute("DELETE FROM scripts WHERE id = ?", (script_id,))
        await db.commit()
    script_dir = _db.SCRIPTS_DIR / script_id
    if script_dir.exists():
        shutil.rmtree(script_dir)
    return {"ok": True}


@router.put("/scripts/swap")
async def swap_scripts(body: SwapRequest, user=Depends(current_user)):
    async with get_db() as db:
        # Without an authorization check here, any authenticated user who
        # guesses two script UUIDs could swap positions and categories of
        # scripts they cannot see — an IDOR that also silently re-shares
        # admin-only scripts into a category their own role is granted.
        await _assert_can_access(db, body.script_id_a, user)
        await _assert_can_access(db, body.script_id_b, user)
        cur_a = await db.execute("SELECT position, category_id FROM scripts WHERE id = ?", (body.script_id_a,))
        cur_b = await db.execute("SELECT position, category_id FROM scripts WHERE id = ?", (body.script_id_b,))
        row_a = await cur_a.fetchone()
        row_b = await cur_b.fetchone()
        # Cross-category swaps transfer category_id, which changes who else
        # can see the script via role_categories — an authz-relevant change
        # that belongs to admin.
        if row_a["category_id"] != row_b["category_id"] and user["role"] != "admin":
            raise HTTPException(403, "Cross-category swap requires admin")
        await db.execute(
            "UPDATE scripts SET position = ?, category_id = ? WHERE id = ?",
            (row_b["position"], row_b["category_id"], body.script_id_a),
        )
        await db.execute(
            "UPDATE scripts SET position = ?, category_id = ? WHERE id = ?",
            (row_a["position"], row_a["category_id"], body.script_id_b),
        )
        await db.commit()
    return {"ok": True}


@router.put("/scripts/{script_id}/category")
async def set_script_category(script_id: str, body: SetCategoryRequest, admin=Depends(require_admin)):
    # Category membership is an authorization grant — it controls which
    # roles can see the script via role_categories. Allowing any user with
    # read access to reassign categories would let them silently share
    # scripts they don't own with other roles. Admin-only.
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
        if body.category_id:
            cat_cur = await db.execute("SELECT id FROM categories WHERE id = ?", (body.category_id,))
            if not await cat_cur.fetchone():
                raise HTTPException(404, "Category not found")
        await db.execute(
            "UPDATE scripts SET category_id = ? WHERE id = ?",
            (body.category_id, script_id),
        )
        await db.commit()
    return {"ok": True}


@router.post("/scripts/{script_id}/run")
async def start_run(script_id: str, user=Depends(current_user)):
    from backend.services import executor
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    run_id = await executor.run_script(script_id)
    return {"run_id": run_id}


@router.post("/scripts/{script_id}/loop")
async def enable_loop(script_id: str, body: LoopRequest, user=Depends(current_user)):
    from backend.services import executor
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    await executor.start_loop(script_id, body.interval)
    return {"ok": True, "interval": body.interval}


@router.post("/scripts/{script_id}/stop")
async def stop_script(script_id: str, user=Depends(current_user)):
    from backend.services import executor
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    await executor.force_stop(script_id)
    return {"ok": True}


@router.post("/scripts/{script_id}/reinstall")
async def reinstall_deps(script_id: str, user=Depends(current_user)):
    from backend.services import executor
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    await executor.force_stop(script_id)
    script_dir = _db.SCRIPTS_DIR / script_id
    venv_dir   = script_dir / "venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    run_id = await executor.run_script(script_id)
    return {"run_id": run_id}


@router.get("/scripts/{script_id}/output")
async def list_output(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    output_dir = _db.SCRIPTS_DIR / script_id / "output"
    if not output_dir.exists():
        return []
    files = []
    for f in sorted(output_dir.rglob("*")):
        if f.is_file():
            stat = f.stat()
            files.append({
                "filename": f.relative_to(output_dir).as_posix(),  # e.g. "subdir/file.rsc"
                "size":     stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return files


def _resolve_output_path(script_id: str, filename: str) -> Path:
    """Resolve ``filename`` under the script's output dir, rejecting traversal
    and symlinks.

    Rejecting symlinks — both on the final component and on any parent
    directory — closes the TOCTOU window where a script could drop a symlink
    pointing at e.g. ``/etc/passwd`` between validation and file open.
    """
    output_dir = (_db.SCRIPTS_DIR / script_id / "output").resolve()
    # Reject path components with NUL bytes or traversal before touching disk.
    if "\x00" in filename:
        raise HTTPException(400, "Invalid filename")
    candidate = (output_dir / filename)
    # Walk each component and refuse symlinks anywhere along the chain.
    rel = Path(filename)
    cur = output_dir
    for part in rel.parts:
        if part in ("..", "") or "/" in part or "\\" in part:
            raise HTTPException(400, "Invalid filename")
        cur = cur / part
        if cur.is_symlink():
            raise HTTPException(400, "Invalid filename")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(output_dir)
    except ValueError:
        raise HTTPException(400, "Invalid filename")
    return resolved


@router.get("/scripts/{script_id}/output/{filename:path}")
async def download_output(script_id: str, filename: str, inline: bool = False, user=Depends(current_user)):
    from fastapi.responses import FileResponse
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    output_file = _resolve_output_path(script_id, filename)
    if not output_file.exists() or not output_file.is_file():
        raise HTTPException(404, "Output file not found")
    # A malicious script can drop an output file that renders as HTML/SVG
    # with attacker-controlled JS. Served inline from /api, it executes in
    # the app origin with the viewer's session cookie. CSP sandbox neuters
    # script execution and same-origin access for the rendered document;
    # we apply it to every output response defensively.
    sandbox_headers = {"Content-Security-Policy": "sandbox"}
    if inline:
        return FileResponse(output_file, headers=sandbox_headers)
    return FileResponse(output_file, filename=output_file.name, headers=sandbox_headers)


@router.delete("/scripts/{script_id}/output/{filename:path}")
async def delete_output(script_id: str, filename: str, user=Depends(current_user)):
    import shutil
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    output_dir = (_db.SCRIPTS_DIR / script_id / "output").resolve()
    target = _resolve_output_path(script_id, filename)
    if not target.exists():
        raise HTTPException(404, "Output path not found")
    if target == output_dir:
        raise HTTPException(400, "Cannot delete the output root")
    if target.is_dir() and not target.is_symlink():
        shutil.rmtree(target)
    else:
        target.unlink()
    # Remove now-empty parent dirs up to output_dir
    for parent in target.parents:
        if parent == output_dir:
            break
        try:
            parent.rmdir()
        except OSError:
            break
    return {"ok": True}


@router.get("/scripts/{script_id}/code")
async def get_script_code(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    script_file = _db.SCRIPTS_DIR / script_id / "script.py"
    if not script_file.exists():
        raise HTTPException(404, "Script file not found")
    return {"code": script_file.read_text(encoding="utf-8")}


@router.put("/scripts/{script_id}/code")
async def update_script_code(script_id: str, body: CodeUpdateRequest, user=Depends(current_user)):
    if len(body.code.encode("utf-8")) > MAX_CODE_BYTES:
        raise HTTPException(413, f"Code exceeds {MAX_CODE_BYTES} bytes")
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    script_file = _db.SCRIPTS_DIR / script_id / "script.py"
    script_file.write_text(body.code, encoding="utf-8")
    return {"ok": True}


@router.get("/scripts/{script_id}/requirements")
async def get_requirements(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    return {"requirements": req_file.read_text(encoding="utf-8") if req_file.exists() else ""}


@router.put("/scripts/{script_id}/requirements")
async def update_requirements(script_id: str, body: RequirementsUpdateRequest, user=Depends(current_user)):
    if len(body.requirements.encode("utf-8")) > MAX_REQUIREMENTS_BYTES:
        raise HTTPException(413, f"requirements.txt exceeds {MAX_REQUIREMENTS_BYTES} bytes")
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    if body.requirements.strip():
        req_file.write_text(body.requirements, encoding="utf-8")
    elif req_file.exists():
        req_file.unlink()
    return {"ok": True}


@router.post("/scripts/{script_id}/requirements/reinstall")
async def save_and_reinstall(script_id: str, body: RequirementsUpdateRequest, user=Depends(current_user)):
    """Write requirements.txt, delete venv, then trigger a fresh reinstall run."""
    if len(body.requirements.encode("utf-8")) > MAX_REQUIREMENTS_BYTES:
        raise HTTPException(413, f"requirements.txt exceeds {MAX_REQUIREMENTS_BYTES} bytes")
    from backend.services import executor
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    if body.requirements.strip():
        req_file.write_text(body.requirements, encoding="utf-8")
    elif req_file.exists():
        req_file.unlink()
    await executor.force_stop(script_id)
    # Nuke the venv so it gets rebuilt with the new requirements
    venv_dir = _db.SCRIPTS_DIR / script_id / "venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    run_id = await executor.run_script(script_id)
    return {"ok": True, "run_id": run_id}


# ── Script variables ──────────────────────────────────────────────────────

MAX_VAR_KEY_LEN = 255
MAX_VAR_VALUE_LEN = 10_000
MAX_VARS_PER_SCRIPT = 50

import re

_VAR_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Keys that must never be overwritten — they control process execution,
# library loading, or are reserved by this application.
_BLOCKED_KEYS = frozenset({
    "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "PWD", "OLDPWD",
    "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV",
    "SCRIPT_OUTPUT_DIR", "SCRIPT_SANDBOX", "SCRIPT_TIMEOUT_SECONDS",
    "SCRIPT_MEMORY_BYTES", "SCRIPT_MAX_PROCS", "SCRIPT_MAX_FILESIZE",
    "SCRIPT_MIN_LOOP_SECONDS", "SCRIPT_MAX_UPLOAD_BYTES",
    "SCRIPT_DB_DIR",
    "DATA_DIR", "DATABASE_URL", "SECRET_KEY",
})


def _validate_var_key(key: str) -> str:
    """Validate and return the stripped key, or raise HTTPException."""
    key = key.strip()
    if not key:
        raise HTTPException(400, "Key cannot be empty")
    if len(key) > MAX_VAR_KEY_LEN:
        raise HTTPException(400, f"Key exceeds {MAX_VAR_KEY_LEN} characters")
    if not _VAR_KEY_RE.match(key):
        raise HTTPException(400, "Key must match [A-Za-z_][A-Za-z0-9_]* (valid env var name)")
    if key.upper() in _BLOCKED_KEYS:
        raise HTTPException(400, f"Key '{key}' is reserved and cannot be set")
    return key


def _validate_var_value(value: str) -> None:
    if len(value) > MAX_VAR_VALUE_LEN:
        raise HTTPException(400, f"Value exceeds {MAX_VAR_VALUE_LEN} characters")
    if "\x00" in value:
        raise HTTPException(400, "Value must not contain null bytes")


@router.get("/scripts/{script_id}/variables")
async def list_variables(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        cur = await db.execute(
            "SELECT key, value FROM script_variables WHERE script_id = ? ORDER BY key",
            (script_id,),
        )
        return [{"key": r["key"], "value": r["value"]} for r in await cur.fetchall()]


@router.put("/scripts/{script_id}/variables")
async def set_variable(script_id: str, body: ScriptVariableRequest, user=Depends(current_user)):
    key = _validate_var_key(body.key)
    _validate_var_value(body.value)
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        cur = await db.execute(
            "SELECT COUNT(*) as cnt FROM script_variables WHERE script_id = ?",
            (script_id,),
        )
        count = (await cur.fetchone())["cnt"]
        existing = await db.execute(
            "SELECT 1 FROM script_variables WHERE script_id = ? AND key = ?",
            (script_id, key),
        )
        if not await existing.fetchone() and count >= MAX_VARS_PER_SCRIPT:
            raise HTTPException(400, f"Maximum {MAX_VARS_PER_SCRIPT} variables per script")
        await db.execute(
            "INSERT INTO script_variables (script_id, key, value) VALUES (?, ?, ?) "
            "ON CONFLICT(script_id, key) DO UPDATE SET value = excluded.value",
            (script_id, key, body.value),
        )
        await db.commit()
    return {"ok": True}


@router.put("/scripts/{script_id}/variables/bulk")
async def set_variables_bulk(script_id: str, body: ScriptVariablesBulkRequest, user=Depends(current_user)):
    if len(body.variables) > MAX_VARS_PER_SCRIPT:
        raise HTTPException(400, f"Maximum {MAX_VARS_PER_SCRIPT} variables per request")
    validated = []
    seen_keys: set[str] = set()
    for v in body.variables:
        key = _validate_var_key(v.key)
        _validate_var_value(v.value)
        if key in seen_keys:
            raise HTTPException(400, f"Duplicate key: {key}")
        seen_keys.add(key)
        validated.append((key, v.value))
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        cur = await db.execute(
            "SELECT COUNT(*) as cnt FROM script_variables WHERE script_id = ?",
            (script_id,),
        )
        existing_count = (await cur.fetchone())["cnt"]
        # Count how many are new (not updates)
        existing_keys: set[str] = set()
        if validated:
            placeholders = ",".join("?" for _ in validated)
            ecur = await db.execute(
                f"SELECT key FROM script_variables WHERE script_id = ? AND key IN ({placeholders})",
                (script_id, *(k for k, _ in validated)),
            )
            existing_keys = {r["key"] for r in await ecur.fetchall()}
        new_count = sum(1 for k, _ in validated if k not in existing_keys)
        if existing_count + new_count > MAX_VARS_PER_SCRIPT:
            raise HTTPException(400, f"Would exceed maximum of {MAX_VARS_PER_SCRIPT} variables")
        for key, value in validated:
            await db.execute(
                "INSERT INTO script_variables (script_id, key, value) VALUES (?, ?, ?) "
                "ON CONFLICT(script_id, key) DO UPDATE SET value = excluded.value",
                (script_id, key, value),
            )
        await db.commit()
    return {"ok": True}


@router.delete("/scripts/{script_id}/variables/{key}")
async def delete_variable(script_id: str, key: str, user=Depends(current_user)):
    _validate_var_key(key)
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        cursor = await db.execute(
            "DELETE FROM script_variables WHERE script_id = ? AND key = ?",
            (script_id, key),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(404, "Variable not found")
    return {"ok": True}


# ── Per-script database grants ─────────────────────────────────────────────
# Databases listed here are the ONLY ones materialized into the script sandbox
# at run time. Reads follow normal script access rules (owner or admin can view);
# writes are admin-only because they control runtime data exposure.

@router.get("/scripts/{script_id}/databases")
async def list_script_dbs(script_id: str, user=Depends(current_user)):
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
        return await dbs.list_script_databases(db, script_id)


@router.put("/scripts/{script_id}/databases")
async def set_script_dbs(
    script_id: str,
    body: ScriptDatabasesUpdateRequest,
    _=Depends(require_admin),
):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
        try:
            await dbs.set_script_databases(db, script_id, body.database_ids)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.list_script_databases(db, script_id)
