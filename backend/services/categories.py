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
    """Delete a category and cascade to children (via FK ON DELETE CASCADE)."""
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
    """Return the set of script IDs accessible to a role through role_categories."""
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
