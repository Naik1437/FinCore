from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.database import async_session_maker
from app.cache import get_redis
from app.config import settings

router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def health_check():
    checks = {
        "status": "healthy",
        "service": "analytics",
        "version": "1.0.0",
        "environment": "development" if settings.DEBUG else "production",
        "services": {
            "database": "unknown",
            "redis": "unknown",
        },
    }

    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
        checks["services"]["database"] = "healthy"
    except Exception:
        checks["services"]["database"] = "unhealthy"
        checks["status"] = "degraded"

    try:
        redis_client = get_redis()
        await redis_client.ping()
        checks["services"]["redis"] = "healthy"
    except Exception:
        checks["services"]["redis"] = "unhealthy"
        checks["status"] = "degraded"

    status_code = 200 if checks["status"] == "healthy" else 503
    return JSONResponse(content=checks, status_code=status_code)


@router.get("/ready")
async def readiness_check():
    try:
        async with async_session_maker() as session:
            await session.execute(text("SELECT 1"))
        redis_client = get_redis()
        await redis_client.ping()
        return {"status": "ready"}
    except Exception as e:
        raise HTTPException(status_code=503, detail={"status": "not ready", "error": str(e)})


@router.get("/live")
async def liveness_check():
    return {"status": "alive"}
