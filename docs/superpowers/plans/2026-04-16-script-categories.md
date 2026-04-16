# Script Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hierarchical categories (up to 5 levels) to organize scripts, with role-based category assignment that grants access to all scripts within a category and its descendants.

**Architecture:** Self-referential `categories` table with `parent_id`. Junction tables `script_categories` and `role_categories` link scripts and roles to categories. A new categories router handles CRUD. Dashboard groups scripts by category. A category manager modal provides tree editing. Role form gains a category tree with cascading checkboxes.

**Tech Stack:** Python/FastAPI (backend), SQLite/aiosqlite (DB), Next.js/React/TypeScript (frontend), motion/react (animations)

---

## File Structure

### Backend (create)
- `backend/routes/categories.py` — Category CRUD endpoints
- `backend/services/categories.py` — Category tree logic, depth validation, descendant resolution

### Backend (modify)
- `backend/db.py` — Add `categories`, `script_categories`, `role_categories` tables
- `backend/models.py` — Add category request/response Pydantic models
- `backend/main.py` — Register categories router
- `backend/routes/scripts.py` — Include categories in script responses, update access check
- `backend/routes/auth.py` — Include `category_ids` in role endpoints
- `backend/services/auth.py` — Add `category_ids` to role CRUD

### Frontend (create)
- `frontend/app/components/CategoryManagerModal.tsx` — Tree editor modal for managing categories + script assignment

### Frontend (modify)
- `frontend/app/page.tsx` — Group scripts by category, add settings button to open category manager
- `frontend/app/users/page.tsx` — Add category tree with cascading checkboxes to role form
- `frontend/app/components/ScriptCard.tsx` — Add `categories` to Script type
- `frontend/app/components/AppShell.tsx` — No changes needed (sidebar stays script-level)

---

### Task 1: Database Schema — Add Category Tables

**Files:**
- Modify: `backend/db.py:17-86`

- [ ] **Step 1: Add the three new tables to `init_db()`**

In `backend/db.py`, add these CREATE TABLE statements after the `role_scripts` table creation (after line 74), before the INSERT OR IGNORE lines:

```python
    await db.execute("""
      CREATE TABLE IF NOT EXISTS categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        parent_id  TEXT,
        position   INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    """)
    await db.execute("""
      CREATE TABLE IF NOT EXISTS script_categories (
        script_id   TEXT NOT NULL,
        category_id TEXT NOT NULL,
        PRIMARY KEY (script_id, category_id),
        FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    """)
    await db.execute("""
      CREATE TABLE IF NOT EXISTS role_categories (
        role_name   TEXT NOT NULL,
        category_id TEXT NOT NULL,
        PRIMARY KEY (role_name, category_id),
        FOREIGN KEY (role_name) REFERENCES roles(name) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    """)
```

- [ ] **Step 2: Verify the app starts with the new schema**

Run: `cd backend && python -c "import asyncio; from backend.db import init_db; asyncio.run(init_db())"`

Expected: No errors. The three new tables exist.

- [ ] **Step 3: Commit**

```bash
git add backend/db.py
git commit -m "feat(db): add categories, script_categories, role_categories tables"
```

---

### Task 2: Pydantic Models for Categories

**Files:**
- Modify: `backend/models.py`

- [ ] **Step 1: Add category models at the end of `backend/models.py`**

```python
class CategoryCreateRequest(BaseModel):
    name: str
    parent_id: Optional[str] = None


class CategoryUpdateRequest(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None


class CategoryReorderRequest(BaseModel):
    category_ids: list[str]


class CategoryScriptsRequest(BaseModel):
    script_ids: list[str]
```

- [ ] **Step 2: Update `RoleCreateRequest` and `RoleUpdateRequest` to include `category_ids`**

```python
class RoleCreateRequest(BaseModel):
    name: str
    script_ids: list[str] = []
    category_ids: list[str] = []


class RoleUpdateRequest(BaseModel):
    script_ids: list[str] = []
    category_ids: list[str] = []
```

- [ ] **Step 3: Commit**

```bash
git add backend/models.py
git commit -m "feat(models): add category Pydantic models, extend role models with category_ids"
```

---

### Task 3: Category Service Layer

**Files:**
- Create: `backend/services/categories.py`

- [ ] **Step 1: Create `backend/services/categories.py`**

```python
"""Category tree operations: CRUD, depth validation, descendant resolution."""
from __future__ import annotations

import uuid

MAX_DEPTH = 5


async def _get_depth(db, category_id: str) -> int:
    """Walk parent_id chain to compute depth (root = 1)."""
    depth = 0
    current = category_id
    while current:
        depth += 1
        cur = await db.execute(
            "SELECT parent_id FROM categories WHERE id = ?", (current,)
        )
        row = await cur.fetchone()
        current = row["parent_id"] if row else None
    return depth


async def _get_max_child_depth(db, category_id: str) -> int:
    """Return the maximum depth among all descendants (0 if no children)."""
    max_d = 0
    cur = await db.execute(
        "SELECT id FROM categories WHERE parent_id = ?", (category_id,)
    )
    children = await cur.fetchall()
    for child in children:
        child_depth = 1 + await _get_max_child_depth(db, child["id"])
        if child_depth > max_d:
            max_d = child_depth
    return max_d


async def get_category_tree(db) -> list[dict]:
    """Return all categories as a nested tree."""
    cur = await db.execute(
        "SELECT id, name, parent_id, position, created_at "
        "FROM categories ORDER BY position ASC, created_at ASC"
    )
    rows = await cur.fetchall()
    by_id: dict[str, dict] = {}
    for r in rows:
        by_id[r["id"]] = {
            "id": r["id"],
            "name": r["name"],
            "parent_id": r["parent_id"],
            "position": r["position"],
            "children": [],
        }
    roots: list[dict] = []
    for node in by_id.values():
        pid = node["parent_id"]
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        else:
            roots.append(node)
    return roots


async def create_category(db, name: str, parent_id: str | None) -> str:
    """Create a category. Validates depth <= MAX_DEPTH."""
    cat_id = str(uuid.uuid4())
    if parent_id:
        cur = await db.execute(
            "SELECT id FROM categories WHERE id = ?", (parent_id,)
        )
        if not await cur.fetchone():
            raise ValueError("Parent category not found")
        parent_depth = await _get_depth(db, parent_id)
        if parent_depth >= MAX_DEPTH:
            raise ValueError(f"Maximum category depth of {MAX_DEPTH} exceeded")
    # Position: append after last sibling
    cur = await db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM categories WHERE parent_id IS ?"
        if parent_id is None else
        "SELECT COALESCE(MAX(position), -1) + 1 FROM categories WHERE parent_id = ?",
        (parent_id,),
    )
    pos = (await cur.fetchone())[0]
    await db.execute(
        "INSERT INTO categories (id, name, parent_id, position) VALUES (?, ?, ?, ?)",
        (cat_id, name, parent_id, pos),
    )
    await db.commit()
    return cat_id


async def update_category(db, cat_id: str, name: str | None, parent_id: str | None) -> None:
    """Update a category's name and/or parent. Validates depth when moving."""
    cur = await db.execute("SELECT id, parent_id FROM categories WHERE id = ?", (cat_id,))
    row = await cur.fetchone()
    if not row:
        raise ValueError("Category not found")
    if name is not None:
        await db.execute("UPDATE categories SET name = ? WHERE id = ?", (name, cat_id))
    if parent_id is not None:
        # Prevent moving a category under itself or its descendants
        if parent_id == cat_id:
            raise ValueError("Cannot make a category its own parent")
        descendants = await get_all_descendant_ids(db, cat_id)
        if parent_id in descendants:
            raise ValueError("Cannot move a category under its own descendant")
        # Check depth: new parent depth + subtree depth of this node
        new_parent_depth = await _get_depth(db, parent_id) if parent_id else 0
        subtree_depth = 1 + await _get_max_child_depth(db, cat_id)
        if new_parent_depth + subtree_depth > MAX_DEPTH:
            raise ValueError(f"Move would exceed maximum depth of {MAX_DEPTH}")
        actual_parent = parent_id if parent_id else None
        await db.execute(
            "UPDATE categories SET parent_id = ? WHERE id = ?",
            (actual_parent, cat_id),
        )
    await db.commit()


async def delete_category(db, cat_id: str) -> None:
    """Delete a category and cascade to children (via FK ON DELETE CASCADE).

    Also cleans up script_categories and role_categories entries for this
    category and all descendants, since SQLite foreign key cascades handle it.
    """
    cur = await db.execute("SELECT id FROM categories WHERE id = ?", (cat_id,))
    if not await cur.fetchone():
        raise ValueError("Category not found")
    await db.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    await db.commit()


async def reorder_categories(db, category_ids: list[str]) -> None:
    """Set position for a list of sibling category IDs."""
    for idx, cat_id in enumerate(category_ids):
        await db.execute(
            "UPDATE categories SET position = ? WHERE id = ?", (idx, cat_id)
        )
    await db.commit()


async def set_category_scripts(db, cat_id: str, script_ids: list[str]) -> None:
    """Replace the scripts assigned to a category."""
    cur = await db.execute("SELECT id FROM categories WHERE id = ?", (cat_id,))
    if not await cur.fetchone():
        raise ValueError("Category not found")
    await db.execute("DELETE FROM script_categories WHERE category_id = ?", (cat_id,))
    for sid in script_ids:
        await db.execute(
            "INSERT OR IGNORE INTO script_categories (script_id, category_id) VALUES (?, ?)",
            (sid, cat_id),
        )
    await db.commit()


async def get_all_descendant_ids(db, cat_id: str) -> set[str]:
    """Recursively collect all descendant category IDs."""
    descendants: set[str] = set()
    cur = await db.execute(
        "SELECT id FROM categories WHERE parent_id = ?", (cat_id,)
    )
    children = await cur.fetchall()
    for child in children:
        descendants.add(child["id"])
        descendants |= await get_all_descendant_ids(db, child["id"])
    return descendants


async def get_script_category_ids(db, script_id: str) -> list[dict]:
    """Return [{id, name}] for all categories a script belongs to."""
    cur = await db.execute(
        "SELECT c.id, c.name FROM categories c "
        "JOIN script_categories sc ON sc.category_id = c.id "
        "WHERE sc.script_id = ?",
        (script_id,),
    )
    return [{"id": r["id"], "name": r["name"]} for r in await cur.fetchall()]


async def get_scripts_accessible_via_categories(db, role_name: str) -> set[str]:
    """Return the set of script IDs accessible to a role through role_categories.

    Expands assigned categories to include all descendants, then collects
    all scripts in those categories.
    """
    cur = await db.execute(
        "SELECT category_id FROM role_categories WHERE role_name = ?",
        (role_name,),
    )
    assigned = [r["category_id"] for r in await cur.fetchall()]
    all_cat_ids: set[str] = set()
    for cid in assigned:
        all_cat_ids.add(cid)
        all_cat_ids |= await get_all_descendant_ids(db, cid)
    if not all_cat_ids:
        return set()
    placeholders = ",".join("?" for _ in all_cat_ids)
    cur = await db.execute(
        f"SELECT DISTINCT script_id FROM script_categories "
        f"WHERE category_id IN ({placeholders})",
        tuple(all_cat_ids),
    )
    return {r["script_id"] for r in await cur.fetchall()}
```

- [ ] **Step 2: Commit**

```bash
git add backend/services/categories.py
git commit -m "feat(services): add category tree service with depth validation and descendant resolution"
```

---

### Task 4: Categories Router

**Files:**
- Create: `backend/routes/categories.py`
- Modify: `backend/main.py:111-114`

- [ ] **Step 1: Create `backend/routes/categories.py`**

```python
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
```

- [ ] **Step 2: Register the categories router in `backend/main.py`**

Add this import at the top with the other route imports (line 8):

```python
from backend.routes import auth, scripts, runs, categories
```

Add this line after the existing router registrations (after line 113):

```python
app.include_router(categories.router, prefix="/api")
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/categories.py backend/main.py
git commit -m "feat(api): add /api/categories CRUD endpoints"
```

---

### Task 5: Update Script Endpoints — Include Categories + Category-Based Access

**Files:**
- Modify: `backend/routes/scripts.py:47-93,181-207`

- [ ] **Step 1: Update `_row_to_meta` to include a `categories` field**

In `backend/routes/scripts.py`, update the `_row_to_meta` function to accept an optional `categories` parameter:

```python
def _row_to_meta(row, categories: list | None = None) -> dict:
    keys = row.keys()
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
        "categories":    categories if categories is not None else [],
    }
```

- [ ] **Step 2: Update `_assert_can_access` to check category-based access**

Replace the `_assert_can_access` function:

```python
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
    # Check direct role-script access
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
```

- [ ] **Step 3: Update `list_scripts` to include categories and category-based access**

Replace the `list_scripts` function:

```python
@router.get("/scripts")
async def list_scripts(user=Depends(current_user)):
    from backend.services import categories as cat_service
    base_sql = """
        SELECT s.*,
               r.status,
               r.started_at AS last_run_at,
               (SELECT COUNT(*) FROM runs WHERE script_id = s.id) AS run_count
        FROM scripts s
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
        result = []
        for r in rows:
            cats = await cat_service.get_script_category_ids(db, r["id"])
            result.append(_row_to_meta(r, cats))
    return result
```

- [ ] **Step 4: Update `get_script` to include categories**

In the `get_script` function, add categories to the response. Replace the return statement:

```python
@router.get("/scripts/{script_id}")
async def get_script(script_id: str, user=Depends(current_user)):
    from backend.services import categories as cat_service
    async with get_db() as db:
        await _assert_can_access(db, script_id, user)
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
        cur = await db.execute(
            "SELECT * FROM runs WHERE script_id = ? ORDER BY started_at DESC",
            (script_id,),
        )
        runs = [dict(r) for r in await cur.fetchall()]
        cats = await cat_service.get_script_category_ids(db, script_id)
    return {**_row_to_meta(row, cats), "runs": runs}
```

- [ ] **Step 5: Commit**

```bash
git add backend/routes/scripts.py
git commit -m "feat(scripts): include categories in responses, add category-based access control"
```

---

### Task 6: Update Role Endpoints — Add Category Assignment

**Files:**
- Modify: `backend/services/auth.py:151-194`
- Modify: `backend/routes/auth.py:162-206`

- [ ] **Step 1: Update `list_roles` in `backend/services/auth.py` to include `category_ids`**

Replace the `list_roles` function:

```python
async def list_roles(db):
    cur = await db.execute("SELECT name FROM roles ORDER BY name")
    roles = []
    for row in await cur.fetchall():
        name = row["name"]
        cur2 = await db.execute(
            "SELECT script_id FROM role_scripts WHERE role_name = ?", (name,)
        )
        script_ids = [r["script_id"] for r in await cur2.fetchall()]
        cur3 = await db.execute(
            "SELECT category_id FROM role_categories WHERE role_name = ?", (name,)
        )
        category_ids = [r["category_id"] for r in await cur3.fetchall()]
        roles.append({"name": name, "script_ids": script_ids, "category_ids": category_ids})
    return roles
```

- [ ] **Step 2: Update `create_role` to accept `category_ids`**

Replace the `create_role` function:

```python
async def create_role(db, name: str, script_ids: list = None, category_ids: list = None) -> str:
    await db.execute("INSERT INTO roles (name) VALUES (?)", (name,))
    for sid in (script_ids or []):
        await db.execute(
            "INSERT OR IGNORE INTO role_scripts (role_name, script_id) VALUES (?, ?)",
            (name, sid),
        )
    for cid in (category_ids or []):
        await db.execute(
            "INSERT OR IGNORE INTO role_categories (role_name, category_id) VALUES (?, ?)",
            (name, cid),
        )
    await db.commit()
    return name
```

- [ ] **Step 3: Add `update_role_categories` function after `update_role_scripts`**

```python
async def update_role_categories(db, role_name: str, category_ids: list) -> None:
    await db.execute("DELETE FROM role_categories WHERE role_name = ?", (role_name,))
    for cid in category_ids:
        await db.execute(
            "INSERT INTO role_categories (role_name, category_id) VALUES (?, ?)",
            (role_name, cid),
        )
    await db.commit()
```

- [ ] **Step 4: Update `delete_role` to also clean up `role_categories`**

Replace the `delete_role` function:

```python
async def delete_role(db, role_name: str) -> None:
    if role_name in ("admin", "user"):
        raise ValueError("Cannot delete system roles")
    cur = await db.execute("SELECT COUNT(*) FROM users WHERE role = ?", (role_name,))
    count = (await cur.fetchone())[0]
    if count > 0:
        raise ValueError(f"Cannot delete role: {count} user(s) still assigned")
    await db.execute("DELETE FROM role_categories WHERE role_name = ?", (role_name,))
    await db.execute("DELETE FROM role_scripts WHERE role_name = ?", (role_name,))
    await db.execute("DELETE FROM roles WHERE name = ?", (role_name,))
    await db.commit()
```

- [ ] **Step 5: Update route handlers in `backend/routes/auth.py`**

Update `create_role` handler to pass `category_ids`:

```python
@router.post("/auth/roles")
async def create_role(body: RoleCreateRequest, admin=Depends(require_admin)):
    async with get_db() as db:
        try:
            await auth_service.create_role(db, body.name, body.script_ids, body.category_ids)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception:
            _log.exception("create_role failed for %r", body.name)
            raise HTTPException(status_code=400, detail="Failed to create role")
    _log.info("role created: %s by %s", body.name, admin["id"])
    return {"name": body.name}
```

Update `update_role` handler to also update `category_ids`:

```python
@router.put("/auth/roles/{role_name}")
async def update_role(role_name: str, body: RoleUpdateRequest, admin=Depends(require_admin)):
    if role_name in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Cannot modify system roles")
    async with get_db() as db:
        await auth_service.update_role_scripts(db, role_name, body.script_ids)
        await auth_service.update_role_categories(db, role_name, body.category_ids)
    return {"ok": True}
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/auth.py backend/routes/auth.py
git commit -m "feat(roles): add category_ids to role CRUD endpoints"
```

---

### Task 7: Frontend — Update Script Type + Fetch Categories

**Files:**
- Modify: `frontend/app/components/ScriptCard.tsx:7-11`

- [ ] **Step 1: Add `categories` to the Script type**

In `frontend/app/components/ScriptCard.tsx`, update the `Script` type:

```typescript
export type Script = {
  id: string; name: string; filename: string; description?: string;
  status?: string; loop_enabled: boolean; loop_interval?: string;
  last_run_at?: string; run_count: number; position?: number;
  categories?: { id: string; name: string }[];
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/ScriptCard.tsx
git commit -m "feat(frontend): add categories field to Script type"
```

---

### Task 8: Frontend — Category Manager Modal

**Files:**
- Create: `frontend/app/components/CategoryManagerModal.tsx`

- [ ] **Step 1: Create the CategoryManagerModal component**

Create `frontend/app/components/CategoryManagerModal.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  children: CategoryNode[];
};

type ScriptSummary = {
  id: string;
  name: string;
};

type Props = {
  onClose: () => void;
};

function TreeNode({
  node,
  depth,
  scripts,
  scriptsByCat,
  onAdd,
  onRename,
  onDelete,
  onToggleScript,
}: {
  node: CategoryNode;
  depth: number;
  scripts: ScriptSummary[];
  scriptsByCat: Map<string, Set<string>>;
  onAdd: (parentId: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleScript: (catId: string, scriptId: string, assigned: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [showScripts, setShowScripts] = useState(false);

  const assigned = scriptsByCat.get(node.id) ?? new Set();

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== node.name) {
      onRename(node.id, editName.trim());
    }
    setEditing(false);
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div className="flex items-center gap-1.5 group py-1">
        {node.children.length > 0 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-4 h-4 flex items-center justify-center text-[10px] text-gray-400 hover:text-gray-600 shrink-0"
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="w-4" />
        )}

        {editing ? (
          <input
            className="text-xs border border-blue-400 rounded px-1.5 py-0.5 bg-transparent focus:outline-none w-32"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") { setEditName(node.name); setEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <span
            className="text-xs font-medium cursor-pointer hover:text-blue-500"
            onDoubleClick={() => { setEditName(node.name); setEditing(true); }}
          >
            {node.name}
          </span>
        )}

        <span className="text-[10px] text-gray-400">({assigned.size})</span>

        <div className="opacity-0 group-hover:opacity-100 flex gap-1 ml-auto transition-opacity">
          <button
            onClick={() => setShowScripts(!showScripts)}
            className="text-[10px] text-gray-400 hover:text-blue-500 px-1"
            title="Assign scripts"
          >
            scripts
          </button>
          {depth < 4 && (
            <button
              onClick={() => onAdd(node.id)}
              className="text-[10px] text-gray-400 hover:text-blue-500 px-1"
              title="Add subcategory"
            >
              + sub
            </button>
          )}
          <button
            onClick={() => onDelete(node.id)}
            className="text-[10px] text-gray-400 hover:text-red-500 px-1"
            title="Delete"
          >
            del
          </button>
        </div>
      </div>

      {/* Script assignment dropdown */}
      <AnimatePresence>
        {showScripts && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="overflow-hidden"
          >
            <div className="ml-5 mb-2 border border-gray-200 dark:border-neutral-700 rounded max-h-40 overflow-y-auto">
              {scripts.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 px-2 py-1 text-[11px] hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={assigned.has(s.id)}
                    onChange={() => onToggleScript(node.id, s.id, assigned.has(s.id))}
                    className="rounded border-gray-300 dark:border-neutral-600"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Children */}
      {expanded && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          scripts={scripts}
          scriptsByCat={scriptsByCat}
          onAdd={onAdd}
          onRename={onRename}
          onDelete={onDelete}
          onToggleScript={onToggleScript}
        />
      ))}
    </div>
  );
}

export default function CategoryManagerModal({ onClose }: Props) {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [scriptsByCat, setScriptsByCat] = useState<Map<string, Set<string>>>(new Map());
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const [catRes, scriptRes] = await Promise.all([
      fetch("/api/categories"),
      fetch("/api/scripts"),
    ]);
    if (catRes.ok) setTree(await catRes.json());
    if (scriptRes.ok) {
      const data = await scriptRes.json();
      setScripts(data.map((s: any) => ({ id: s.id, name: s.name })));
      // Build scriptsByCat map from script.categories
      const map = new Map<string, Set<string>>();
      for (const s of data) {
        for (const cat of s.categories ?? []) {
          if (!map.has(cat.id)) map.set(cat.id, new Set());
          map.get(cat.id)!.add(s.id);
        }
      }
      setScriptsByCat(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const addCategory = async (parentId: string | null) => {
    const name = parentId ? "New subcategory" : newName.trim();
    if (!name) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id: parentId }),
    });
    if (res.ok) {
      setNewName("");
      loadData();
    }
  };

  const renameCategory = async (id: string, name: string) => {
    await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    loadData();
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category and all its subcategories?")) return;
    await fetch(`/api/categories/${id}`, { method: "DELETE" });
    loadData();
  };

  const toggleScript = async (catId: string, scriptId: string, wasAssigned: boolean) => {
    const current = scriptsByCat.get(catId) ?? new Set();
    const updated = new Set(current);
    if (wasAssigned) {
      updated.delete(scriptId);
    } else {
      updated.add(scriptId);
    }
    await fetch(`/api/categories/${catId}/scripts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script_ids: [...updated] }),
    });
    loadData();
    window.dispatchEvent(new Event("scripts-changed"));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.12 }}
        className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-700 shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : (
            <>
              {tree.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  scripts={scripts}
                  scriptsByCat={scriptsByCat}
                  onAdd={addCategory}
                  onRename={renameCategory}
                  onDelete={deleteCategory}
                  onToggleScript={toggleScript}
                />
              ))}
              {tree.length === 0 && (
                <p className="text-xs text-gray-400 py-2">No categories yet.</p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-neutral-800 px-5 py-3">
          <div className="flex gap-2">
            <input
              className="flex-1 text-xs border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New top-level category"
              onKeyDown={(e) => { if (e.key === "Enter") addCategory(null); }}
            />
            <button
              onClick={() => addCategory(null)}
              disabled={!newName.trim()}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/CategoryManagerModal.tsx
git commit -m "feat(frontend): add CategoryManagerModal with tree editor and script assignment"
```

---

### Task 9: Frontend — Dashboard Grouped by Category + Settings Button

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Add imports and state for category manager**

At the top of `frontend/app/page.tsx`, add the import (after the LogDrawer import):

```typescript
import CategoryManagerModal from "./components/CategoryManagerModal";
```

Inside the `Dashboard` component, add state after the existing state declarations:

```typescript
const [showCategories, setShowCategories] = useState(false);
```

- [ ] **Step 2: Add the settings button next to the "+ Add Script" button**

In the filter bar section, add a settings button before the "+ Add Script" button. Replace the existing button section (the `motion.button` for "+ Add Script") with:

```tsx
<div className="flex items-center gap-2">
  <motion.button
    whileHover={{ scale: 1.03 }}
    whileTap={{ scale: 0.97 }}
    onClick={() => setShowCategories(true)}
    className="text-xs border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 px-3 py-1.5 rounded font-medium"
    title="Manage categories"
  >
    Categories
  </motion.button>
  <motion.button
    whileHover={{ scale: 1.03 }}
    whileTap={{ scale: 0.97 }}
    onClick={() => setShowUpload(true)}
    className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-medium"
  >
    + Add Script
  </motion.button>
</div>
```

- [ ] **Step 3: Group scripts by category in the card grid**

Add a helper function inside the Dashboard component (before the return statement) to group scripts:

```typescript
// Group scripts by category for display
type CategoryGroup = {
  id: string | null;
  name: string;
  scripts: Script[];
};

const groupedScripts = (() => {
  const groups: CategoryGroup[] = [];
  const seenCats = new Set<string>();
  const uncategorized: Script[] = [];

  // Collect all unique categories in order
  for (const s of filteredScripts) {
    if (!s.categories?.length) {
      uncategorized.push(s);
      continue;
    }
    for (const cat of s.categories) {
      if (!seenCats.has(cat.id)) {
        seenCats.add(cat.id);
        groups.push({ id: cat.id, name: cat.name, scripts: [] });
      }
    }
  }
  // Assign scripts to their categories
  for (const s of filteredScripts) {
    if (!s.categories?.length) continue;
    for (const cat of s.categories) {
      const g = groups.find(g => g.id === cat.id);
      if (g) g.scripts.push(s);
    }
  }
  if (uncategorized.length > 0) {
    groups.push({ id: null, name: "Uncategorized", scripts: uncategorized });
  }
  return groups;
})();
```

- [ ] **Step 4: Replace the card grid rendering to use grouped layout**

Replace the entire `<AnimatePresence mode="popLayout">` block (lines 233-298) with:

```tsx
<AnimatePresence mode="popLayout">
  {filteredScripts.length === 0 ? (
    <motion.p
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="text-xs text-gray-400 mt-4"
    >
      No scripts match this filter.
    </motion.p>
  ) : groupedScripts.length <= 1 && groupedScripts[0]?.id === null ? (
    /* No categories assigned — flat grid like before */
    isDraggable ? (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={filteredScripts.map(s => s.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {filteredScripts.map((s, i) => (
                <SortableScriptCard
                  key={s.id}
                  script={s}
                  onRun={handleRun}
                  onLoop={handleLoop}
                  onStop={handleStop}
                  onLogs={() => setLogsFor(s)}
                  index={hasLoaded.current ? 0 : i}
                />
              ))}
            </AnimatePresence>
          </div>
        </SortableContext>
        <DragOverlay>
          {activeScript ? (
            <div className="opacity-90 shadow-2xl rounded-xl">
              <ScriptCard
                script={activeScript}
                onRun={handleRun}
                onLoop={handleLoop}
                onStop={handleStop}
                onLogs={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    ) : (
      <div className="grid grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {filteredScripts.map((s, i) => (
            <StaticScriptCard
              key={s.id}
              script={s}
              onRun={handleRun}
              onLoop={handleLoop}
              onStop={handleStop}
              onLogs={() => setLogsFor(s)}
              index={i}
            />
          ))}
        </AnimatePresence>
      </div>
    )
  ) : (
    /* Grouped by category */
    <div className="space-y-4">
      {groupedScripts.map((group) => (
        <CategorySection
          key={group.id ?? "uncategorized"}
          group={group}
          onRun={handleRun}
          onLoop={handleLoop}
          onStop={handleStop}
          onLogs={setLogsFor}
        />
      ))}
    </div>
  )}
</AnimatePresence>
```

- [ ] **Step 5: Add the CategorySection component**

Add this component at the top of `page.tsx`, after the `StaticScriptCard` component:

```tsx
function CategorySection({
  group,
  onRun,
  onLoop,
  onStop,
  onLogs,
}: {
  group: { id: string | null; name: string; scripts: Script[] };
  onRun: (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: (s: Script) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 mb-2 group"
      >
        <span className="text-[10px] text-gray-400 transition-transform" style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
          ▼
        </span>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {group.name}
        </span>
        <span className="text-[10px] text-gray-400">({group.scripts.length})</span>
      </button>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-3 gap-3">
              {group.scripts.map((s, i) => (
                <StaticScriptCard
                  key={s.id}
                  script={s}
                  onRun={onRun}
                  onLoop={onLoop}
                  onStop={onStop}
                  onLogs={() => onLogs(s)}
                  index={i}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 6: Add the CategoryManagerModal to the modals section**

After the existing `<AnimatePresence>` blocks for upload and logs modals (around line 302-307), add:

```tsx
<AnimatePresence>
  {showCategories && <CategoryManagerModal onClose={() => { setShowCategories(false); refresh(); }} />}
</AnimatePresence>
```

- [ ] **Step 7: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(dashboard): group scripts by category, add category manager button"
```

---

### Task 10: Frontend — Category Tree in Role Form

**Files:**
- Modify: `frontend/app/users/page.tsx`

- [ ] **Step 1: Add category types and state**

Update the `Role` type to include `category_ids`:

```typescript
type Role = {
  name: string;
  script_ids: string[];
  category_ids: string[];
};
```

Add a `CategoryNode` type:

```typescript
type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  children: CategoryNode[];
};
```

Add state variables inside the `UsersPage` component, alongside the existing role state:

```typescript
const [categories, setCategories] = useState<CategoryNode[]>([]);
const [roleCategories, setRoleCategories] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Fetch categories in `loadAll`**

Update the `loadAll` function to also fetch categories. Add a fetch for categories:

```typescript
const loadAll = useCallback(async () => {
  setError("");
  const [usersRes, rolesRes, scriptsRes, catsRes] = await Promise.all([
    fetch("/api/auth/users"),
    fetch("/api/auth/roles"),
    fetch("/api/scripts"),
    fetch("/api/categories"),
  ]);
  if (usersRes.status === 403) {
    setDenied(true);
    setLoading(false);
    return;
  }
  if (!usersRes.ok) {
    setError(await usersRes.text());
    setLoading(false);
    return;
  }
  setRows(await usersRes.json());
  if (rolesRes.ok) setRoles(await rolesRes.json());
  if (scriptsRes.ok) setScripts(await scriptsRes.json());
  if (catsRes.ok) setCategories(await catsRes.json());
  setLoading(false);
}, []);
```

- [ ] **Step 3: Update role open/edit functions to handle categories**

Update `openCreateRole`:

```typescript
const openCreateRole = () => {
  setEditingRole(null);
  setRoleName("");
  setRoleScripts(new Set());
  setRoleCategories(new Set());
  setShowRoleForm(true);
};
```

Update `openEditRole`:

```typescript
const openEditRole = (role: Role) => {
  setEditingRole(role.name);
  setRoleName(role.name);
  setRoleScripts(new Set(role.script_ids));
  setRoleCategories(new Set(role.category_ids));
  setShowRoleForm(true);
};
```

- [ ] **Step 4: Update `saveRole` to include `category_ids`**

```typescript
const saveRole = async () => {
  setSavingRole(true); setError("");
  try {
    if (editingRole) {
      const res = await fetch(`/api/auth/roles/${encodeURIComponent(editingRole)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_ids: [...roleScripts], category_ids: [...roleCategories] }),
      });
      if (!res.ok) throw new Error(await res.text());
    } else {
      const res = await fetch("/api/auth/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roleName, script_ids: [...roleScripts], category_ids: [...roleCategories] }),
      });
      if (!res.ok) throw new Error(await res.text());
    }
    setShowRoleForm(false);
    loadAll();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally { setSavingRole(false); }
};
```

- [ ] **Step 5: Add helper to collect all descendant IDs for cascading checkboxes**

```typescript
const collectDescendantIds = (node: CategoryNode): string[] => {
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child));
  }
  return ids;
};

const findNode = (nodes: CategoryNode[], id: string): CategoryNode | null => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
};

const toggleCategory = (id: string) => {
  setRoleCategories(prev => {
    const next = new Set(prev);
    const node = findNode(categories, id);
    if (!node) return next;
    const descendants = collectDescendantIds(node);
    if (next.has(id)) {
      // Uncheck this and all descendants
      next.delete(id);
      for (const d of descendants) next.delete(d);
    } else {
      // Check this and all descendants
      next.add(id);
      for (const d of descendants) next.add(d);
    }
    return next;
  });
};
```

- [ ] **Step 6: Add the category tree checkbox renderer**

Add a `CategoryCheckboxTree` component inside the file (before the `UsersPage` export):

```tsx
function CategoryCheckboxTree({
  nodes,
  selected,
  onToggle,
  depth = 0,
}: {
  nodes: CategoryNode[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const checked = selected.has(node.id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.id}>
            <label
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer"
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(node.id)}
                className="rounded border-gray-300 dark:border-neutral-600"
              />
              <span className="text-xs">{node.name}</span>
              {hasChildren && (
                <span className="text-[10px] text-gray-400 ml-auto">
                  {node.children.length} sub
                </span>
              )}
            </label>
            {hasChildren && (
              <CategoryCheckboxTree
                nodes={node.children}
                selected={selected}
                onToggle={onToggle}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 7: Add the category section to the role create/edit dialog**

In the role form dialog (the `showRoleForm` conditional), add a category tree section after the scripts section. Insert this block after the closing `</div>` of the scripts `max-h-[300px]` container and before the action buttons:

```tsx
{categories.length > 0 && (
  <div className="mb-4">
    <label className="block text-[10px] text-gray-400 mb-2">Categories this role can access</label>
    <div className="max-h-[200px] overflow-y-auto border border-gray-200 dark:border-neutral-700 rounded-lg divide-y divide-gray-100 dark:divide-neutral-800">
      <CategoryCheckboxTree
        nodes={categories}
        selected={roleCategories}
        onToggle={toggleCategory}
      />
    </div>
    <p className="text-[10px] text-gray-400 mt-1">Selecting a category grants access to all scripts in it and its subcategories.</p>
  </div>
)}
```

- [ ] **Step 8: Update the role summary text to show category count**

In the role list section, update the description for non-system roles to show categories too. Replace the existing script count paragraph:

```tsx
{!isSystem && (
  <p className="text-[10px] text-gray-400 mt-0.5">
    {r.script_ids.length === 0 && r.category_ids.length === 0
      ? "No scripts or categories assigned"
      : [
          r.script_ids.length > 0 && `${r.script_ids.length} script${r.script_ids.length > 1 ? "s" : ""}`,
          r.category_ids.length > 0 && `${r.category_ids.length} categor${r.category_ids.length > 1 ? "ies" : "y"}`,
        ].filter(Boolean).join(", ") + " assigned"}
  </p>
)}
```

- [ ] **Step 9: Commit**

```bash
git add frontend/app/users/page.tsx
git commit -m "feat(roles): add category tree with cascading checkboxes to role form"
```

---

### Task 11: Cleanup + Final Verification

**Files:**
- Delete: `docs/superpowers/specs/2026-04-16-script-categories-design.md`
- Delete: `docs/superpowers/plans/2026-04-16-script-categories.md`

- [ ] **Step 1: Start the backend and verify no import/startup errors**

Run: `cd backend && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000`

Expected: Server starts without errors. New tables created on startup.

- [ ] **Step 2: Test the category API manually**

```bash
# Create a category
curl -b cookies.txt -X POST http://localhost:8000/api/categories \
  -H 'Content-Type: application/json' \
  -d '{"name": "Infrastructure"}'

# List categories
curl -b cookies.txt http://localhost:8000/api/categories
```

- [ ] **Step 3: Start the frontend and verify it builds**

Run: `cd frontend && npm run dev`

Expected: No TypeScript errors. Dashboard loads. Categories button visible.

- [ ] **Step 4: Delete the design spec and plan files**

```bash
rm docs/superpowers/specs/2026-04-16-script-categories-design.md
rm docs/superpowers/plans/2026-04-16-script-categories.md
rmdir docs/superpowers/specs docs/superpowers/plans docs/superpowers 2>/dev/null; true
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: remove design spec and plan files after implementation"
```
