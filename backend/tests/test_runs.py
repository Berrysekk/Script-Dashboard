import pytest


@pytest.mark.asyncio
async def test_log_download_missing(client):
    res = await client.get("/api/runs/no-such-id/log")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_get_run_missing(client):
    res = await client.get("/api/runs/no-such-id")
    assert res.status_code == 404
