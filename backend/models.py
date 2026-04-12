from pydantic import BaseModel
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


class LoopRequest(BaseModel):
    interval: str   # e.g. "6h", "30m", "5s"
