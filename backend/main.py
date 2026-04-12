from contextlib import asynccontextmanager
from fastapi import FastAPI
from backend.db import init_db
from backend.routes import scripts, runs

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(lifespan=lifespan)
app.include_router(scripts.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
