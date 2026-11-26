"""Automated Test Suite for FinCore Assessment 05: Python Financial Calculations."""
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.calculations.engine import (
    FinancialCalculationEngine,
    TieredFeeSchedule,
    FeeTier,
    RoundingMode,
    InterestAccrualMethod,
    DayCountConvention,
)
from app.main import app

# Standard test fee schedule
standard_tiers = [
    FeeTier(min_amount=Decimal("0.0000"), max_amount=Decimal("1000.0000"), percentage=Decimal("1.5000"), fixed_fee=Decimal("0.3000")),
    FeeTier(min_amount=Decimal("1000.0000"), max_amount=Decimal("10000.0000"), percentage=Decimal("1.0000"), fixed_fee=Decimal("0.2500")),
    FeeTier(min_amount=Decimal("10000.0000"), max_amount=None, percentage=Decimal("0.5000"), fixed_fee=Decimal("0.2000")),
]

schedule_marginal = TieredFeeSchedule(
    name="Test Marginal Schedule",
    tiers=standard_tiers,
    min_fee=Decimal("0.5000"),
    max_fee=Decimal("150.0000"),
    is_marginal=True,
)

schedule_flat = TieredFeeSchedule(
    name="Test Flat Schedule",
    tiers=standard_tiers,
    min_fee=Decimal("0.5000"),
    max_fee=Decimal("150.0000"),
    is_marginal=False,
)


# =====================================================================
# 1. Tiered Fee Engine Tests
# =====================================================================
def test_tiered_fee_marginal_tier_one():
    # $500 transfer in tier 1: 500 * 1.5% = $7.50 + $0.30 = $7.8000
    fee, breakdown = FinancialCalculationEngine.calculate_tiered_fee(Decimal("500.0000"), schedule_marginal)
    assert fee == Decimal("7.8000")
    assert len(breakdown) == 1
    assert breakdown[0]["tier_min"] == "0.0000"


def test_tiered_fee_marginal_multi_bracket():
    # $2,500 transfer across tiers 1 & 2:
    # Tier 1 ($1000): 1000 * 1.5% = 15.00 + 0.30 = 15.30
    # Tier 2 ($1500): 1500 * 1.0% = 15.00 + 0.25 = 15.25
    # Total = 15.30 + 15.25 = 30.5500
    fee, breakdown = FinancialCalculationEngine.calculate_tiered_fee(Decimal("2500.0000"), schedule_marginal)
    assert fee == Decimal("30.5500")
    assert len(breakdown) == 2


def test_tiered_fee_minimum_fee_floor():
    # $5 transfer: 5 * 1.5% = 0.075 + 0.30 = 0.3750 -> Below min_fee ($0.5000)
    fee, _ = FinancialCalculationEngine.calculate_tiered_fee(Decimal("5.0000"), schedule_marginal)
    assert fee == Decimal("0.5000")


def test_tiered_fee_maximum_fee_ceiling():
    # $100,000 transfer would exceed max_fee cap
    fee, _ = FinancialCalculationEngine.calculate_tiered_fee(Decimal("100000.0000"), schedule_marginal)
    assert fee == Decimal("150.0000")


def test_tiered_fee_flat_mode():
    # $5,000 in flat mode falls into Tier 2 (1000 to 10000):
    # 5000 * 1.0% = 50.00 + 0.25 = 50.2500
    fee, breakdown = FinancialCalculationEngine.calculate_tiered_fee(Decimal("5000.0000"), schedule_flat)
    assert fee == Decimal("50.2500")
    assert len(breakdown) == 1


def test_tiered_fee_zero_and_negative_validation():
    # Zero amount yields 0 fee
    fee_zero, _ = FinancialCalculationEngine.calculate_tiered_fee(Decimal("0.0000"), schedule_marginal)
    assert fee_zero == Decimal("0.0000")

    # Negative amount raises ValueError
    with pytest.raises(ValueError, match="cannot be negative"):
        FinancialCalculationEngine.calculate_tiered_fee(Decimal("-10.0000"), schedule_marginal)


# =====================================================================
# 2. Interest Accrual Tests
# =====================================================================
def test_interest_accrual_daily_compound():
    # $10,000 principal at 5% APR for 30 days:
    # A = 10000 * (1 + 0.05 / 365)^30
    accrued, total = FinancialCalculationEngine.calculate_interest_accrual(
        principal=Decimal("10000.0000"),
        annual_rate_percent=Decimal("5.0000"),
        days=30,
        method=InterestAccrualMethod.DAILY_COMPOUND,
        day_count=DayCountConvention.ACT_365,
    )
    # Expected: ~41.1764
    assert accrued > Decimal("41.0000") and accrued < Decimal("41.3000")
    assert total == Decimal("10000.0000") + accrued


def test_interest_accrual_simple():
    # $10,000 principal at 6% APR for 180 days on ACT/360:
    # I = 10000 * 0.06 * (180 / 360) = 300.0000
    accrued, total = FinancialCalculationEngine.calculate_interest_accrual(
        principal=Decimal("10000.0000"),
        annual_rate_percent=Decimal("6.0000"),
        days=180,
        method=InterestAccrualMethod.SIMPLE,
        day_count=DayCountConvention.ACT_360,
    )
    assert accrued == Decimal("300.0000")
    assert total == Decimal("10300.0000")


def test_interest_accrual_continuous():
    # $1,000 principal at 10% APR for 365 days continuously compounded
    # A = 1000 * e^(0.10 * 1) = 1000 * 1.1051709... = 1105.1709
    accrued, total = FinancialCalculationEngine.calculate_interest_accrual(
        principal=Decimal("1000.0000"),
        annual_rate_percent=Decimal("10.0000"),
        days=365,
        method=InterestAccrualMethod.CONTINUOUS,
        day_count=DayCountConvention.ACT_365,
    )
    assert accrued == Decimal("105.1709")
    assert total == Decimal("1105.1709")


def test_interest_accrual_boundary_and_validation():
    # Zero days
    accrued, total = FinancialCalculationEngine.calculate_interest_accrual(
        principal=Decimal("5000.0000"),
        annual_rate_percent=Decimal("5.0000"),
        days=0,
    )
    assert accrued == Decimal("0.0000")
    assert total == Decimal("5000.0000")

    # Negative days
    with pytest.raises(ValueError, match="cannot be negative"):
        FinancialCalculationEngine.calculate_interest_accrual(
            principal=Decimal("1000.0000"),
            annual_rate_percent=Decimal("5.0000"),
            days=-5,
        )


# =====================================================================
# 3. Statement Financial Aggregation Tests
# =====================================================================
def test_statement_summary_exact_invariance():
    # Opening balance $5,000 with multiple transactions
    txns = [
        {"amount": "1250.5000", "entry_type": "credit", "type": "deposit"},
        {"amount": "300.2500", "entry_type": "debit", "type": "payment"},
        {"amount": "45.7500", "entry_type": "debit", "type": "transfer"},
        {"amount": "500.0000", "entry_type": "credit", "type": "deposit"},
        {"amount": "1200.0000", "entry_type": "debit", "type": "withdrawal"},
    ]

    res = FinancialCalculationEngine.calculate_statement_summary(
        opening_balance=Decimal("5000.0000"),
        transactions=txns,
        days_in_period=30,
    )

    # Total credits: 1250.50 + 500.00 = 1750.5000
    # Total debits: 300.25 + 45.75 + 1200.00 = 1546.0000
    # Net flow: 1750.50 - 1546.00 = +204.5000
    # Closing balance: 5000 + 204.50 = 5204.5000
    assert res.total_credits == Decimal("1750.5000")
    assert res.total_debits == Decimal("1546.0000")
    assert res.net_flow == Decimal("204.5000")
    assert res.closing_balance == Decimal("5204.5000")
    assert res.discrepancy == Decimal("0.0000")
    assert res.transaction_count == 5


# =====================================================================
# 4. Financial Reconciliation Tests
# =====================================================================
def test_reconciliation_balanced_batches():
    sys_records = [
        {"reference_id": "TX-001", "amount": "150.0000", "entry_type": "credit"},
        {"reference_id": "TX-002", "amount": "320.5000", "entry_type": "credit"},
    ]
    ext_records = [
        {"reference_id": "TX-001", "amount": "150.0000"},
        {"reference_id": "TX-002", "amount": "320.5000"},
    ]

    res = FinancialCalculationEngine.reconcile_batches(sys_records, ext_records)
    assert res.is_balanced is True
    assert res.net_difference == Decimal("0.0000")
    assert res.matched_records_count == 2
    assert len(res.discrepancy_records) == 0


def test_reconciliation_detects_discrepancy_and_unmatched():
    sys_records = [
        {"reference_id": "TX-001", "amount": "150.0000", "entry_type": "credit"},
        {"reference_id": "TX-002", "amount": "320.5000", "entry_type": "credit"},
        {"reference_id": "TX-003", "amount": "50.0000", "entry_type": "credit"},
    ]
    ext_records = [
        {"reference_id": "TX-001", "amount": "150.0000"},
        {"reference_id": "TX-002", "amount": "320.4500"},  # 5 cents discrepancy
        {"reference_id": "TX-004", "amount": "99.0000"},   # Unmatched external
    ]

    res = FinancialCalculationEngine.reconcile_batches(sys_records, ext_records)
    assert res.is_balanced is False
    assert len(res.discrepancy_records) == 1
    assert res.discrepancy_records[0]["difference"] == "0.0500"
    assert len(res.unmatched_system_records) == 1  # TX-003
    assert len(res.unmatched_external_records) == 1  # TX-004


# =====================================================================
# 5. Rounding Modes Tests
# =====================================================================
def test_rounding_modes():
    # 2.5055 to 3 decimals:
    # HALF_EVEN: 2.506 (rounds to nearest even)
    # HALF_UP: 2.506
    # DOWN: 2.505
    # UP: 2.506
    val = Decimal("2.5055")
    assert FinancialCalculationEngine.quantize_currency(val, 3, RoundingMode.HALF_EVEN) == Decimal("2.506")
    assert FinancialCalculationEngine.quantize_currency(val, 3, RoundingMode.HALF_UP) == Decimal("2.506")
    assert FinancialCalculationEngine.quantize_currency(val, 3, RoundingMode.DOWN) == Decimal("2.505")
    assert FinancialCalculationEngine.quantize_currency(val, 3, RoundingMode.UP) == Decimal("2.506")

    # Banker's rounding test: 2.5045 -> 2.504 (even), 2.5055 -> 2.506 (even)
    assert FinancialCalculationEngine.quantize_currency(Decimal("2.5045"), 3, RoundingMode.HALF_EVEN) == Decimal("2.504")


# =====================================================================
# 6. Precision & Accumulator Drift Benchmark Test
# =====================================================================
def test_precision_benchmark_proof():
    res = FinancialCalculationEngine.run_precision_benchmark(iterations=10_000)
    assert res.iterations == 10_000
    assert res.decimal_drift == Decimal("0")  # Exact zero drift with Decimal
    assert res.decimal_final_sum == Decimal("1000.0")
    # Binary float accumulator has drift
    assert res.float_drift != 0.0


# =====================================================================
# 7. FastAPI HTTP Route Integration Tests
# =====================================================================
def test_api_fee_endpoint():
    client = TestClient(app, raise_server_exceptions=False)
    payload = {
        "amount": "1500.0000",
        "is_marginal": True,
        "rounding_mode": "HALF_EVEN",
        "decimals": 4,
    }
    response = client.post("/api/v1/calculations/fees", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "fee" in data
    assert "tier_breakdown" in data
    assert Decimal(data["fee"]) > Decimal("0")


def test_api_interest_endpoint():
    client = TestClient(app, raise_server_exceptions=False)
    payload = {
        "principal": "25000.0000",
        "annual_rate_percent": "4.5000",
        "days": 60,
        "method": "DAILY_COMPOUND",
        "day_count": "ACT/365",
        "rounding_mode": "HALF_EVEN",
        "decimals": 4,
    }
    response = client.post("/api/v1/calculations/interest", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert Decimal(data["accrued_interest"]) > Decimal("0")
    assert Decimal(data["final_balance"]) > Decimal(payload["principal"])


def test_api_statement_endpoint():
    client = TestClient(app, raise_server_exceptions=False)
    payload = {
        "opening_balance": "10000.0000",
        "transactions": [
            {"amount": "500.0000", "entry_type": "credit", "type": "deposit"},
            {"amount": "200.0000", "entry_type": "debit", "type": "payment"},
        ],
        "days_in_period": 30,
        "rounding_mode": "HALF_EVEN",
        "decimals": 4,
    }
    response = client.post("/api/v1/calculations/statement", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["closing_balance"] == "10300.0000"
    assert data["net_flow"] == "300.0000"
    assert data["is_invariable"] is True


def test_api_reconciliation_endpoint():
    client = TestClient(app, raise_server_exceptions=False)
    payload = {
        "system_records": [
            {"id": "rec-1", "amount": "100.0000", "entry_type": "credit"},
            {"id": "rec-2", "amount": "200.0000", "entry_type": "credit"},
        ],
        "external_records": [
            {"reference_id": "rec-1", "amount": "100.0000"},
            {"reference_id": "rec-2", "amount": "200.0000"},
        ],
        "decimals": 4,
    }
    response = client.post("/api/v1/calculations/reconciliation", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_balanced"] is True
    assert data["matched_records_count"] == 2


def test_api_benchmark_endpoint():
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/api/v1/calculations/benchmark?iterations=20000")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["iterations"] == 20000
    assert data["python_decimal"]["has_drift"] is False
    assert data["binary_float"]["has_drift"] is True
