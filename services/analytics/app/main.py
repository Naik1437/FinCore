from contextlib import asynccontextmanager
from hmac import compare_digest
from os import getenv

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import structlog

from app.config import settings
from app.routes import health, analytics, metrics, calculations, risk
from app.database import init_db, close_db
from app.cache import init_redis, close_redis

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting FinCore Analytics Service")
    await init_db()
    await init_redis()
    yield
    logger.info("Shutting down FinCore Analytics Service")
    await close_redis()
    await close_db()


app = FastAPI(
    title="FinCore Analytics",
    description="Analytics service for FinCore Digital Wallet & Payment Platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    if request.url.path.startswith("/api/v1/") and request.method != "OPTIONS":
        token = getenv("ANALYTICS_SERVICE_TOKEN", "")
        if getenv("ANALYTICS_ENV") == "production" and len(token) < 32:
            return JSONResponse({"detail": "Analytics authorization is unavailable"}, status_code=503)
        supplied = request.headers.get("x-analytics-token", "")
        if token and not compare_digest(supplied.encode(), token.encode()):
            return JSONResponse({"detail": "Analytics authorization required"}, status_code=401)
    logger.info("Request received", method=request.method, path=request.url.path)
    response = await call_next(request)
    logger.info("Request completed", method=request.method, path=request.url.path, status_code=response.status_code)
    return response


app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["analytics"])
app.include_router(metrics.router, prefix="/api/v1/metrics", tags=["metrics"])
app.include_router(calculations.router, prefix="/api/v1/calculations", tags=["calculations"])
app.include_router(risk.router, prefix="/api/v1/risk", tags=["risk"])


@app.get("/")
async def root():
    return {
        "name": "FinCore Analytics",
        "version": "1.0.0",
        "description": "Analytics service for FinCore Digital Wallet & Payment Platform",
        "docs": "/docs",
        "health": "/health",
        "calculations": "/api/v1/calculations",
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )
