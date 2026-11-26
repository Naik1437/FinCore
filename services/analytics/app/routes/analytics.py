from fastapi import APIRouter, Query
from typing import Optional
from datetime import datetime, timedelta
from pydantic import BaseModel

router = APIRouter()


class WalletAnalytics(BaseModel):
    wallet_id: str
    total_transactions: int
    total_volume: float
    avg_transaction_amount: float
    currency: str
    period_start: datetime
    period_end: datetime


class TransactionAnalytics(BaseModel):
    total_count: int
    total_volume: float
    by_type: dict
    by_status: dict
    by_currency: dict
    period_start: datetime
    period_end: datetime


@router.get("/wallets/{wallet_id}", response_model=WalletAnalytics)
async def get_wallet_analytics(
    wallet_id: str,
    days: int = Query(default=30, ge=1, le=365),
):
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    return WalletAnalytics(
        wallet_id=wallet_id,
        total_transactions=0,
        total_volume=0.0,
        avg_transaction_amount=0.0,
        currency="USD",
        period_start=start_date,
        period_end=end_date,
    )


@router.get("/transactions", response_model=TransactionAnalytics)
async def get_transaction_analytics(
    wallet_id: Optional[str] = None,
    days: int = Query(default=30, ge=1, le=365),
):
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    return TransactionAnalytics(
        total_count=0,
        total_volume=0.0,
        by_type={},
        by_status={},
        by_currency={},
        period_start=start_date,
        period_end=end_date,
    )


@router.get("/summary")
async def get_summary(
    days: int = Query(default=30, ge=1, le=365),
):
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    return {
        "period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": days,
        },
        "wallets": {
            "total": 0,
            "active": 0,
        },
        "transactions": {
            "total_count": 0,
            "total_volume": 0.0,
            "successful": 0,
            "failed": 0,
            "pending": 0,
        },
        "ledger": {
            "total_entries": 0,
            "total_debits": 0.0,
            "total_credits": 0.0,
        },
    }
