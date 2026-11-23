from fastapi import APIRouter
from datetime import datetime
from typing import List
from pydantic import BaseModel

router = APIRouter()


class MetricPoint(BaseModel):
    timestamp: datetime
    value: float
    labels: dict = {}


class TimeSeriesResponse(BaseModel):
    metric: str
    points: List[MetricPoint]
    aggregation: str


@router.get("/transaction-volume", response_model=TimeSeriesResponse)
async def get_transaction_volume(
    interval: str = "1h",
    hours: int = 24,
):
    return TimeSeriesResponse(
        metric="transaction_volume",
        points=[],
        aggregation=interval,
    )


@router.get("/transaction-count", response_model=TimeSeriesResponse)
async def get_transaction_count(
    interval: str = "1h",
    hours: int = 24,
):
    return TimeSeriesResponse(
        metric="transaction_count",
        points=[],
        aggregation=interval,
    )


@router.get("/wallet-balance", response_model=TimeSeriesResponse)
async def get_wallet_balance(
    wallet_id: str,
    interval: str = "1h",
    hours: int = 24,
):
    return TimeSeriesResponse(
        metric="wallet_balance",
        points=[],
        aggregation=interval,
    )


@router.get("/active-users", response_model=TimeSeriesResponse)
async def get_active_users(
    interval: str = "1d",
    days: int = 30,
):
    return TimeSeriesResponse(
        metric="active_users",
        points=[],
        aggregation=interval,
    )


@router.get("/error-rate", response_model=TimeSeriesResponse)
async def get_error_rate(
    interval: str = "1h",
    hours: int = 24,
):
    return TimeSeriesResponse(
        metric="error_rate",
        points=[],
        aggregation=interval,
    )