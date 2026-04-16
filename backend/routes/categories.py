"""Category CRUD endpoints (admin-only)."""
import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.db import get_db
from backend.deps import require_admin
from backend.models import (
    CategoryCreateRequest,
    CategoryUpdateRequest,
    CategoryReorderRequest,
    CategoryScriptsRequest,
)
from backend.services import categories as cat_service

_log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/categories")
async def list_categories(admin=Depends(require_admin)):
    async with get_db() as db:
        return await cat_service.get_category_tree(db)


@router.post("/categories")
async def create_category(body: CategoryCreateRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            cat_id = await cat_service.create_category(db, body.name, body.parent_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    _log.info("category created: %s by %s", cat_id, admin["id"])
    return {"id": cat_id, "name": body.name, "parent_id": body.parent_id}


@router.patch("/categories/{cat_id}")
async def update_category(cat_id: str, body: CategoryUpdateRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await cat_service.update_category(db, cat_id, body.name, body.parent_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: str, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await cat_service.delete_category(db, cat_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    _log.info("category deleted: %s by %s", cat_id, admin["id"])
    return {"ok": True}


@router.put("/categories/reorder")
async def reorder_categories(body: CategoryReorderRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        await cat_service.reorder_categories(db, body.category_ids)
    return {"ok": True}


@router.put("/categories/{cat_id}/scripts")
async def set_category_scripts(cat_id: str, body: CategoryScriptsRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await cat_service.set_category_scripts(db, cat_id, body.script_ids)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}
