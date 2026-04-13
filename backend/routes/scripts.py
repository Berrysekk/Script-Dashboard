import uuid, json, zipfile, io, shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import backend.db as _db
from backend.db import get_db
from backend.models import ScriptUpdateRequest, LoopRequest, CodeUpdateRequest, RequirementsUpdateRequest

router = APIRouter()


def _row_to_meta(row) -> dict:
    keys = row.keys()
    return {
        "id":            row["id"],
        "name":          row["name"],
        "filename":      row["filename"],
        "description":   row["description"],
        "loop_enabled":  bool(row["loop_enabled"]),
        "loop_interval": row["loop_interval"],
        "created_at":    row["created_at"],
        "status":        row["status"]       if "status"       in keys else None,
        "last_run_at":   row["last_run_at"]  if "last_run_at"  in keys else None,
        "run_count":     row["run_count"]    if "run_count"    in keys else 0,
    }


@router.post("/scripts")
async def upload_script(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
):
    script_id  = str(uuid.uuid4())
    script_dir  = _db.SCRIPTS_DIR / script_id
    script_dir.mkdir(parents=True, exist_ok=True)
    (script_dir / "output").mkdir(exist_ok=True)

    content  = await file.read()
    filename = file.filename or "script.py"

    if filename.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            py_files = [n for n in zf.namelist() if n.endswith(".py")]
            if not py_files:
                raise HTTPException(400, "zip must contain a .py file")
            data = zf.read(py_files[0])
            (script_dir / "script.py").write_bytes(data)
            if "requirements.txt" in zf.namelist():
                (script_dir / "requirements.txt").write_bytes(zf.read("requirements.txt"))
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
            "INSERT INTO scripts (id, name, filename, description) VALUES (?, ?, ?, ?)",
            (script_id, display_name, filename, description),
        )
        await db.commit()

    return {**meta, "status": "idle", "last_run_at": None, "run_count": 0}


@router.get("/scripts")
async def list_scripts():
    async with get_db() as db:
        cur = await db.execute("""
            SELECT s.*,
                   r.status,
                   r.started_at AS last_run_at,
                   (SELECT COUNT(*) FROM runs WHERE script_id = s.id) AS run_count
            FROM scripts s
            LEFT JOIN runs r ON r.id = (
                SELECT id FROM runs WHERE script_id = s.id
                ORDER BY started_at DESC LIMIT 1
            )
            ORDER BY s.created_at DESC
        """)
        rows = await cur.fetchall()
    return [_row_to_meta(r) for r in rows]


@router.get("/scripts/{script_id}")
async def get_script(script_id: str):
    async with get_db() as db:
        cur = await db.execute("""
            SELECT s.*,
                   r.status,
                   r.started_at AS last_run_at,
                   (SELECT COUNT(*) FROM runs WHERE script_id = s.id) AS run_count
            FROM scripts s
            LEFT JOIN runs r ON r.id = (
                SELECT id FROM runs WHERE script_id = s.id
                ORDER BY started_at DESC LIMIT 1
            )
            WHERE s.id = ?
        """, (script_id,))
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Script not found")
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC",
            (script_id,)
        )
        runs = [dict(r) for r in await cur.fetchall()]
    return {**_row_to_meta(row), "runs": runs}


@router.patch("/scripts/{script_id}")
async def patch_script(script_id: str, body: ScriptUpdateRequest):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
        if body.name is not None:
            await db.execute("UPDATE scripts SET name=? WHERE id=?", (body.name, script_id))
        if body.description is not None:
            await db.execute("UPDATE scripts SET description=? WHERE id=?", (body.description, script_id))
        if body.loop_interval is not None:
            await db.execute("UPDATE scripts SET loop_interval=? WHERE id=?", (body.loop_interval, script_id))
        if body.loop_enabled is not None:
            await db.execute("UPDATE scripts SET loop_enabled=? WHERE id=?", (int(body.loop_enabled), script_id))
        await db.commit()
    return await get_script(script_id)


@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id = ?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
        await db.execute("DELETE FROM runs WHERE script_id = ?", (script_id,))
        await db.execute("DELETE FROM scripts WHERE id = ?", (script_id,))
        await db.commit()
    script_dir = _db.SCRIPTS_DIR / script_id
    if script_dir.exists():
        shutil.rmtree(script_dir)
    return {"ok": True}


@router.post("/scripts/{script_id}/run")
async def start_run(script_id: str):
    from backend.services import executor
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    run_id = await executor.run_script(script_id)
    return {"run_id": run_id}


@router.post("/scripts/{script_id}/loop")
async def enable_loop(script_id: str, body: LoopRequest):
    from backend.services import executor
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    await executor.start_loop(script_id, body.interval)
    return {"ok": True, "interval": body.interval}


@router.post("/scripts/{script_id}/stop")
async def stop_script(script_id: str):
    from backend.services import executor
    await executor.stop_loop(script_id)
    return {"ok": True}


@router.post("/scripts/{script_id}/reinstall")
async def reinstall_deps(script_id: str):
    from backend.services import executor
    script_dir = _db.SCRIPTS_DIR / script_id
    venv_dir   = script_dir / "venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    run_id = await executor.run_script(script_id)
    return {"run_id": run_id}


@router.get("/scripts/{script_id}/output")
async def list_output(script_id: str):
    output_dir = _db.SCRIPTS_DIR / script_id / "output"
    if not output_dir.exists():
        return []
    files = []
    for f in sorted(output_dir.iterdir()):
        if f.is_file():
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size":     stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return files


@router.get("/scripts/{script_id}/output/{filename}")
async def download_output(script_id: str, filename: str):
    from fastapi.responses import FileResponse
    output_dir = _db.SCRIPTS_DIR / script_id / "output"
    output_file = (output_dir / filename).resolve()
    if not str(output_file).startswith(str(output_dir.resolve())):
        raise HTTPException(400, "Invalid filename")
    if not output_file.exists() or not output_file.is_file():
        raise HTTPException(404, "Output file not found")
    return FileResponse(output_file, filename=filename)


@router.delete("/scripts/{script_id}/output/{filename}")
async def delete_output(script_id: str, filename: str):
    output_dir = _db.SCRIPTS_DIR / script_id / "output"
    output_file = (output_dir / filename).resolve()
    if not str(output_file).startswith(str(output_dir.resolve())):
        raise HTTPException(400, "Invalid filename")
    if not output_file.exists():
        raise HTTPException(404, "Output file not found")
    output_file.unlink()
    return {"ok": True}


@router.get("/scripts/{script_id}/code")
async def get_script_code(script_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    script_file = _db.SCRIPTS_DIR / script_id / "script.py"
    if not script_file.exists():
        raise HTTPException(404, "Script file not found")
    return {"code": script_file.read_text(encoding="utf-8")}


@router.put("/scripts/{script_id}/code")
async def update_script_code(script_id: str, body: CodeUpdateRequest):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    script_file = _db.SCRIPTS_DIR / script_id / "script.py"
    script_file.write_text(body.code, encoding="utf-8")
    return {"ok": True}


@router.get("/scripts/{script_id}/requirements")
async def get_requirements(script_id: str):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    return {"requirements": req_file.read_text(encoding="utf-8") if req_file.exists() else ""}


@router.put("/scripts/{script_id}/requirements")
async def update_requirements(script_id: str, body: RequirementsUpdateRequest):
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    if body.requirements.strip():
        req_file.write_text(body.requirements, encoding="utf-8")
    elif req_file.exists():
        req_file.unlink()
    return {"ok": True}


@router.post("/scripts/{script_id}/requirements/reinstall")
async def save_and_reinstall(script_id: str, body: RequirementsUpdateRequest):
    """Write requirements.txt, delete venv, then trigger a fresh reinstall run."""
    from backend.services import executor
    async with get_db() as db:
        cur = await db.execute("SELECT id FROM scripts WHERE id=?", (script_id,))
        if not await cur.fetchone():
            raise HTTPException(404, "Script not found")
    req_file = _db.SCRIPTS_DIR / script_id / "requirements.txt"
    if body.requirements.strip():
        req_file.write_text(body.requirements, encoding="utf-8")
    elif req_file.exists():
        req_file.unlink()
    # Nuke the venv so it gets rebuilt with the new requirements
    venv_dir = _db.SCRIPTS_DIR / script_id / "venv"
    if venv_dir.exists():
        shutil.rmtree(venv_dir)
    run_id = await executor.run_script(script_id)
    return {"ok": True, "run_id": run_id}
