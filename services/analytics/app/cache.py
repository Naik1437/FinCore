import redis.asyncio as redis
import structlog
from app.config import settings

logger = structlog.get_logger()

redis_client: redis.Redis | None = None


async def init_redis() -> None:
    global redis_client
    try:
        redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
        await redis_client.ping()
        logger.info("Redis connected successfully")
    except Exception as e:
        logger.warning("Redis connection failed during startup", error=str(e))


async def close_redis() -> None:
    global redis_client
    if redis_client:
        if hasattr(redis_client, "aclose"):
            await redis_client.aclose()
        else:
            await redis_client.close()
        redis_client = None


def get_redis() -> redis.Redis:
    if not redis_client:
        raise RuntimeError("Redis not initialized")
    return redis_client
