# Script Categories Design

## Overview

Add a hierarchical category system to organize scripts on the dashboard. Categories form a tree (up to 5 levels deep). Scripts can belong to multiple categories. Roles can be assigned whole categories, granting access to all scripts in that category and its descendants.

## Data Model

### New Tables

```sql
categories (
  id          TEXT PRIMARY KEY,   -- UUID
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id) ON DELETE CASCADE,
  position    INTEGER DEFAULT 0,  -- ordering among siblings
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
)

script_categories (
  script_id   TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (script_id, category_id)
)

role_categories (
  role_name   TEXT REFERENCES roles(name) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (role_name, category_id)
)
```

### Constraints

- Max depth: 5 levels (enforced at API level, not DB level)
- Deleting a category cascades to children and removes junction table entries
- Scripts with no category remain accessible and appear in an "Uncategorized" section
- Existing `role_scripts` table continues to work alongside `role_categories`

## Backend API

### New Endpoints (all require_admin)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/categories` | Full category tree as nested JSON |
| POST | `/api/categories` | Create category (`name`, optional `parent_id`) |
| PATCH | `/api/categories/{id}` | Rename or move (`name`, `parent_id`) |
| DELETE | `/api/categories/{id}` | Delete category + cascade children |
| PUT | `/api/categories/reorder` | Reorder siblings within a parent |
| PUT | `/api/categories/{id}/scripts` | Set script IDs for a category |

### Modified Endpoints

- `GET /api/scripts` — each script includes `categories: [{id, name}]`
- `POST /api/scripts` / `PATCH /api/scripts/{id}` — accept optional `category_ids: string[]`
- `GET /api/auth/roles` — response includes `category_ids` alongside `script_ids`
- `PUT /api/auth/roles/{role_name}` — accepts `category_ids` alongside `script_ids`

### Access Resolution

Access to a script is granted if **any** of these conditions is true:

1. User is admin
2. User owns the script (`owner_id == user.id`)
3. Script is in `role_scripts` for the user's role
4. Script belongs to a category (or descendant of a category) assigned to the user's role via `role_categories`

Descendant resolution: given a role's `role_categories` entries, recursively collect all descendant category IDs, then check if the script has any `script_categories` entry matching those IDs.

### Category Tree Response Format

```json
[
  {
    "id": "uuid",
    "name": "Infrastructure",
    "parent_id": null,
    "position": 0,
    "children": [
      {
        "id": "uuid",
        "name": "Monitoring",
        "parent_id": "parent-uuid",
        "position": 0,
        "children": []
      }
    ]
  }
]
```

## Frontend

### Dashboard Changes

- Scripts grouped visually by category in collapsible sections
- Category headers show the category name with expand/collapse toggle
- Nested subcategories indent within their parent section
- Uncategorized scripts appear in a separate section at the bottom
- Scripts in multiple categories appear in each relevant section
- Existing filters (all/running/idle) apply within categories
- Drag-to-reorder works within a category section

### Category Manager Modal

Triggered from a settings button in the dashboard header. Contains:

- Tree view of all categories with indentation showing hierarchy
- Inline add: text input at any level to create a new category/subcategory
- Inline rename: click to edit category name
- Delete: remove button with confirmation (warns about cascade)
- Drag to reorder siblings within the same parent
- Script assignment: select/deselect scripts for each category
- Max depth enforcement: hide "add subcategory" action at level 5

### Role Management (Admin Page)

In `users/page.tsx`, the role edit form adds a category tree alongside existing script assignment:

- Tree view with checkboxes at each node
- Checking a parent auto-checks all children
- Unchecking a child while parent is checked sets parent to indeterminate state
- Checking individual subcategories without parent is allowed
- Visual distinction between directly assigned and inherited (via parent) categories
