"""FastAPI Router for Decimal Financial Calculations.

Assessment 05: Python Financial Calculations
"""
from decimal import Decimal
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.calculations.engine import (
    FinancialCalculationEngine,
    TieredFeeSchedule,
    FeeTier,
    RoundingMode,
    InterestAccrualMethod,
    DayCountConvention,
)

router = APIRouter()


# Pydantic Request & Response Schemas
class FeeTierInput(BaseModel):
    min_amount: str = Field(..., description="Minimum transaction amount for this tier")
    max_amount: Optional[str] = Field(None, description="Maximum amount for this tier, or None for unbounded")
    percentage: str = Field(..., description="Percentage rate (e.g. '1.5' for 1.5%)")
    fixed_fee: str = Field("0.0000", description="Fixed fee component")


class CalculateFeeRequest(BaseModel):
    amount: str = Field(..., description="Transaction amount")
    tiers: Optional[List[FeeTierInput]] = Field(
        None,
        description="Optional custom tier schedule. Defaults to FinCore standard transfer schedule if omitted."
    )
    is_marginal: bool = Field(True, description="True for progressive marginal tiers, False for flat tier")
    min_fee: Optional[str] = Field(None, description="Minimum fee floor")
    max_fee: Optional[str] = Field(None, description="Maximum fee ceiling")
    rounding_mode: RoundingMode = Field(RoundingMode.HALF_EVEN, description="Rounding strategy")
    decimals: int = Field(4, ge=2, le=6, description="Decimal precision")


class CalculateInterestRequest(BaseModel):
    principal: str = Field(..., description="Starting principal balance")
    annual_rate_percent: str = Field(..., description="Annual interest rate percentage (APR)")
    days: int = Field(..., ge=0, description="Number of days accrued")
    method: InterestAccrualMethod = Field(InterestAccrualMethod.DAILY_COMPOUND, description="Accrual formula")
    day_count: DayCountConvention = Field(DayCountConvention.ACT_365, description="Day count convention")
    rounding_mode: RoundingMode = Field(RoundingMode.HALF_EVEN, description="Rounding strategy")
    decimals: int = Field(4, ge=2, le=6, description="Decimal precision")


class TransactionInput(BaseModel):
    amount: str
    day_of_period: Optional[int] = Field(None, ge=1, description="One-based posting day in the statement period")
    type: Optional[str] = None
    entry_type: Optional[str] = None
    description: Optional[str] = None


class CalculateStatementRequest(BaseModel):
    opening_balance: str
    transactions: List[TransactionInput]
    days_in_period: int = Field(30, ge=1, description="Days in billing cycle")
    rounding_mode: RoundingMode = Field(RoundingMode.HALF_EVEN)
    decimals: int = Field(4, ge=2, le=6)


class RecordItem(BaseModel):
    id: Optional[str] = None
    reference_id: Optional[str] = None
    transaction_id: Optional[str] = None
    amount: str
    entry_type: Optional[str] = "credit"


class ReconcileRequest(BaseModel):
    system_records: List[RecordItem]
    external_records: List[RecordItem]
    decimals: int = Field(4, ge=2, le=6)


# Default FinCore tiered fee schedule
DEFAULT_TIERS = [
    FeeTier(min_amount=Decimal("0.0000"), max_amount=Decimal("1000.0000"), percentage=Decimal("1.5000"), fixed_fee=Decimal("0.3000")),
    FeeTier(min_amount=Decimal("1000.0000"), max_amount=Decimal("10000.0000"), percentage=Decimal("1.0000"), fixed_fee=Decimal("0.2500")),
    FeeTier(min_amount=Decimal("10000.0000"), max_amount=None, percentage=Decimal("0.5000"), fixed_fee=Decimal("0.2000")),
]


@router.post("/fees")
async def calculate_fees(req: CalculateFeeRequest) -> Dict[str, Any]:
    """Calculate exact tiered transaction fee using Decimal arithmetic."""
    try:
        if req.tiers:
            parsed_tiers = [
                FeeTier(
                    min_amount=Decimal(t.min_amount),
                    max_amount=Decimal(t.max_amount) if t.max_amount is not None else None,
                    percentage=Decimal(t.percentage),
                    fixed_fee=Decimal(t.fixed_fee),
                )
                for t in req.tiers
            ]
        else:
            parsed_tiers = DEFAULT_TIERS

        schedule = TieredFeeSchedule(
            name="Custom Tier Schedule" if req.tiers else "FinCore Standard Schedule",
            tiers=parsed_tiers,
            min_fee=Decimal(req.min_fee) if req.min_fee is not None else None,
            max_fee=Decimal(req.max_fee) if req.max_fee is not None else None,
            is_marginal=req.is_marginal,
        )

        fee, breakdown = FinancialCalculationEngine.calculate_tiered_fee(
            amount=req.amount,
            schedule=schedule,
            mode=req.rounding_mode,
            decimals=req.decimals,
        )

        return {
            "status": "success",
            "amount": str(FinancialCalculationEngine.to_decimal(req.amount)),
            "fee": str(fee),
            "net_amount": str(FinancialCalculationEngine.to_decimal(req.amount) - fee),
            "is_marginal": req.is_marginal,
            "rounding_mode": req.rounding_mode.value,
            "tier_breakdown": breakdown,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {e}") from e


@router.post("/interest")
async def calculate_interest(req: CalculateInterestRequest) -> Dict[str, Any]:
    """Calculate daily compounded or simple interest accrual with arbitrary-precision Decimal."""
    try:
        accrued, final_balance = FinancialCalculationEngine.calculate_interest_accrual(
            principal=req.principal,
            annual_rate_percent=req.annual_rate_percent,
            days=req.days,
            method=req.method,
            day_count=req.day_count,
            mode=req.rounding_mode,
            decimals=req.decimals,
        )

        return {
            "status": "success",
            "principal": str(FinancialCalculationEngine.to_decimal(req.principal)),
            "annual_rate_percent": str(FinancialCalculationEngine.to_decimal(req.annual_rate_percent)),
            "days": req.days,
            "method": req.method.value,
            "day_count_convention": req.day_count.value,
            "accrued_interest": str(accrued),
            "final_balance": str(final_balance),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Interest calculation error: {e}") from e


@router.post("/statement")
async def calculate_statement(req: CalculateStatementRequest) -> Dict[str, Any]:
    """Aggregate financial statement metrics with zero floating-point accumulation drift."""
    try:
        txns = [t.model_dump() for t in req.transactions]
        summary = FinancialCalculationEngine.calculate_statement_summary(
            opening_balance=req.opening_balance,
            transactions=txns,
            days_in_period=req.days_in_period,
            mode=req.rounding_mode,
            decimals=req.decimals,
        )

        return {
            "status": "success",
            "opening_balance": str(summary.opening_balance),
            "closing_balance": str(summary.closing_balance),
            "total_debits": str(summary.total_debits),
            "total_credits": str(summary.total_credits),
            "net_flow": str(summary.net_flow),
            "transaction_count": summary.transaction_count,
            "average_daily_balance": (str(summary.average_daily_balance)
                                      if summary.average_daily_balance is not None else None),
            "discrepancy": str(summary.discrepancy),
            "is_invariable": summary.discrepancy == Decimal("0.0000"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Statement calculation error: {e}") from e


@router.post("/reconciliation")
async def reconcile_financial_records(req: ReconcileRequest) -> Dict[str, Any]:
    """Perform dual-source reconciliation between internal ledger and external batches."""
    try:
        sys_records = [s.model_dump() for s in req.system_records]
        ext_records = [e.model_dump() for e in req.external_records]

        result = FinancialCalculationEngine.reconcile_batches(
            system_records=sys_records,
            external_records=ext_records,
            decimals=req.decimals,
        )

        return {
            "status": "success",
            "is_balanced": result.is_balanced,
            "system_total_debits": str(result.system_total_debits),
            "system_total_credits": str(result.system_total_credits),
            "external_total_cleared": str(result.external_total_cleared),
            "net_difference": str(result.net_difference),
            "matched_records_count": result.matched_records_count,
            "unmatched_system_records_count": len(result.unmatched_system_records),
            "unmatched_external_records_count": len(result.unmatched_external_records),
            "discrepancies_count": len(result.discrepancy_records),
            "discrepancies": result.discrepancy_records,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reconciliation error: {e}") from e


@router.get("/benchmark")
async def precision_benchmark(
    iterations: int = Query(100_000, ge=10_000, le=1_000_000, description="Accumulation loop count")
) -> Dict[str, Any]:
    """Demonstrate IEEE 754 binary floating-point drift vs Python Decimal correctness."""
    result = FinancialCalculationEngine.run_precision_benchmark(iterations=iterations)
    return {
        "status": "success",
        "iterations": result.iterations,
        "step_value": result.step_value,
        "binary_float": {
            "final_sum": result.float_final_sum,
            "expected_sum": result.float_expected_sum,
            "accumulator_drift": result.float_drift,
            "has_drift": result.float_drift != 0.0,
        },
        "python_decimal": {
            "final_sum": str(result.decimal_final_sum),
            "expected_sum": str(result.decimal_expected_sum),
            "accumulator_drift": str(result.decimal_drift),
            "has_drift": result.decimal_drift != Decimal("0"),
        },
        "execution_time_ms": result.execution_time_ms,
        "conclusion": result.precision_advantage,
    }
