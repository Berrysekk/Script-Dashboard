from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ScriptMeta(BaseModel):
    id: str
    name: str
    filename: str
    description: Optional[str] = None
    loop_enabled: bool = False
    loop_interval: Optional[str] = None
    created_at: datetime
    status: Optional[str] = None
    last_run_at: Optional[datetime] = None
    run_count: int = 0


class RunRecord(BaseModel):
    id: str
    script_id: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    exit_code: Optional[int] = None
    log_path: str
    status: str


class ScriptUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    loop_interval: Optional[str] = None
    loop_enabled: Optional[bool] = None


class LoopRequest(BaseModel):
    interval: str   # e.g. "6h", "30m", "5s"


class CodeUpdateRequest(BaseModel):
    code: str


class RequirementsUpdateRequest(BaseModel):
    requirements: str


class SwapRequest(BaseModel):
    script_id_a: str
    script_id_b: str


class SetCategoryRequest(BaseModel):
    category_id: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class ResetPasswordRequest(BaseModel):
    username: str
    master_password: str
    new_password: str


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class RoleCreateRequest(BaseModel):
    name: str
    script_ids: list[str] = []
    category_ids: list[str] = []
    database_ids: list[str] = []


class RoleUpdateRequest(BaseModel):
    script_ids: list[str] = []
    category_ids: list[str] = []
    database_ids: list[str] = []


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    created_at: Optional[datetime] = None


class ScriptVariableRequest(BaseModel):
    key: str
    value: str = ""


class ScriptVariablesBulkRequest(BaseModel):
    variables: list[ScriptVariableRequest]


class CategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[str] = None


class CategoryUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    parent_id: Optional[str] = None


class CategoryReorderRequest(BaseModel):
    category_ids: list[str]


class DatabaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = Field(default=None, max_length=1000)


class DatabaseUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    slug: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = Field(default=None, max_length=1000)


class DatabaseColumnCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    key: str = Field(min_length=1, max_length=64)
    type: str
    config: Optional[dict] = None


class DatabaseColumnUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    type: Optional[str] = None
    config: Optional[dict] = None


class DatabaseColumnReorderRequest(BaseModel):
    column_ids: list[str]


class DatabaseRowCreateRequest(BaseModel):
    values: dict


class DatabaseRowUpdateRequest(BaseModel):
    values: dict


class DatabaseRowReorderRequest(BaseModel):
    row_ids: list[str]


