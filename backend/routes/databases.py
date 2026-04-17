"""Database CRUD endpoints — columns, rows, and role-based access control."""

from fastapi import APIRouter, Depends, HTTPException

from backend.db import get_db
from backend.deps import current_user, require_admin
from backend.models import (
    DatabaseColumnCreateRequest,
    DatabaseColumnReorderRequest,
    DatabaseColumnUpdateRequest,
    DatabaseCreateRequest,
    DatabaseRowCreateRequest,
    DatabaseRowReorderRequest,
    DatabaseRowUpdateRequest,
    DatabaseUpdateRequest,
)
from backend.services import databases as dbs


router = APIRouter(prefix="/databases", tags=["databases"])


def _redact_secrets(data: dict, is_admin: bool) -> dict:
    """Mask secret column values for non-admin readers."""
    if is_admin or not data:
        return data
    secret_keys = {c["key"] for c in data["columns"] if c["type"] == "secret"}
    if not secret_keys:
        return data
    redacted_rows = []
    for r in data["rows"]:
        vals = dict(r["values"])
        for k in secret_keys:
            if k in vals and vals[k] is not None:
                vals[k] = "••••••"
        redacted_rows.append({**r, "values": vals})
    return {**data, "rows": redacted_rows}


@router.get("")
async def list_databases(user=Depends(current_user)):
    async with get_db() as db:
        items = await dbs.list_databases(db)
        if user["role"] == "admin":
            return items
        cur = await db.execute(
            "SELECT database_id FROM role_databases WHERE role_name = ?",
            (user["role"],),
        )
        accessible = {r["database_id"] for r in await cur.fetchall()}
        return [x for x in items if x["id"] in accessible]


@router.post("")
async def create_database(payload: DatabaseCreateRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            db_id = await dbs.create_database(
                db, payload.name, payload.slug, payload.description
            )
        except dbs.SlugConflict as e:
            raise HTTPException(
                status_code=409,
                detail={"error": "slug_taken", "suggestion": e.suggestion},
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        data = await dbs.get_database(db, db_id)
    return data


@router.get("/{db_id}")
async def get_database(db_id: str, user=Depends(current_user)):
    async with get_db() as db:
        if user["role"] != "admin":
            cur = await db.execute(
                "SELECT 1 FROM role_databases WHERE role_name = ? AND database_id = ?",
                (user["role"], db_id),
            )
            if not await cur.fetchone():
                raise HTTPException(403, "Not authorized")
        data = await dbs.get_database(db, db_id)
    if not data:
        raise HTTPException(404, "Database not found")
    return _redact_secrets(data, user["role"] == "admin")


@router.patch("/{db_id}")
async def update_database(db_id: str, payload: DatabaseUpdateRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.update_database(
                db, db_id, payload.name, payload.slug, payload.description
            )
        except dbs.SlugConflict as e:
            raise HTTPException(
                status_code=409,
                detail={"error": "slug_taken", "suggestion": e.suggestion},
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)


@router.delete("/{db_id}")
async def delete_database(db_id: str, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.delete_database(db, db_id)
        except ValueError as e:
            raise HTTPException(404, str(e))
    return {"ok": True}


@router.post("/{db_id}/columns")
async def create_column(db_id: str, payload: DatabaseColumnCreateRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.create_column(
                db, db_id, payload.name, payload.key, payload.type, payload.config
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)


@router.patch("/{db_id}/columns/{col_id}")
async def update_column(
    db_id: str, col_id: str, payload: DatabaseColumnUpdateRequest, _=Depends(require_admin)
):
    async with get_db() as db:
        try:
            result = await dbs.update_column(
                db, db_id, col_id, payload.name, payload.type, payload.config
            )
        except dbs.OptionsInUse as e:
            raise HTTPException(
                status_code=400,
                detail={"error": "options_in_use", "affected_row_ids": e.affected_row_ids},
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        data = await dbs.get_database(db, db_id)
    return {**data, "coercion": result}


@router.delete("/{db_id}/columns/{col_id}")
async def delete_column(db_id: str, col_id: str, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.delete_column(db, db_id, col_id)
        except ValueError as e:
            raise HTTPException(404, str(e))
        return await dbs.get_database(db, db_id)


@router.put("/{db_id}/columns/reorder")
async def reorder_columns(db_id: str, payload: DatabaseColumnReorderRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.reorder_columns(db, db_id, payload.column_ids)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)


@router.post("/{db_id}/rows")
async def create_row(db_id: str, payload: DatabaseRowCreateRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.create_row(db, db_id, payload.values)
        except dbs.RowValidationError as e:
            raise HTTPException(
                status_code=400, detail={"errors": e.errors}
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)


@router.patch("/{db_id}/rows/{row_id}")
async def update_row(db_id: str, row_id: str, payload: DatabaseRowUpdateRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.update_row(db, db_id, row_id, payload.values)
        except dbs.RowValidationError as e:
            raise HTTPException(
                status_code=400, detail={"errors": e.errors}
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)


@router.delete("/{db_id}/rows/{row_id}")
async def delete_row(db_id: str, row_id: str, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.delete_row(db, db_id, row_id)
        except ValueError as e:
            raise HTTPException(404, str(e))
        return await dbs.get_database(db, db_id)


@router.put("/{db_id}/rows/reorder")
async def reorder_rows(db_id: str, payload: DatabaseRowReorderRequest, _=Depends(require_admin)):
    async with get_db() as db:
        try:
            await dbs.reorder_rows(db, db_id, payload.row_ids)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return await dbs.get_database(db, db_id)
