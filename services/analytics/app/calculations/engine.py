"""FinCore High-Precision Decimal Financial Calculation Engine.

Assessment 05: Python Financial Calculations
Enforces exact fixed-point and arbitrary-precision decimal arithmetic
to eliminate binary floating-point drift in financial systems.
"""
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_DOWN, ROUND_UP, getcontext
from enum import Enum
import time
from typing import Any, Dict, List, Optional, Tuple

# Set high-precision financial context (28 decimal places default)
getcontext().prec = 28


class RoundingMode(str, Enum):
    HALF_EVEN = "HALF_EVEN"  # Banker's rounding (financial standard)
    HALF_UP = "HALF_UP"      # Commercial / asymmetric rounding
    DOWN = "DOWN"            # Truncation
    UP = "UP"                # Ceiling


class InterestAccrualMethod(str, Enum):
    SIMPLE = "SIMPLE"
    DAILY_COMPOUND = "DAILY_COMPOUND"
    MONTHLY_COMPOUND = "MONTHLY_COMPOUND"
    CONTINUOUS = "CONTINUOUS"


class DayCountConvention(str, Enum):
    ACT_365 = "ACT/365"
    ACT_360 = "ACT/360"
    THIRTY_360 = "30/360"


@dataclass
class FeeTier:
    """Represents a bracket in a tiered fee schedule."""
    min_amount: Decimal
    max_amount: Optional[Decimal]  # None indicates infinity / unbound upper tier
    percentage: Decimal            # Rate as percentage, e.g. Decimal("1.5") for 1.5%
    fixed_fee: Decimal = Decimal("0.0000")


@dataclass
class TieredFeeSchedule:
    """Tiered fee configuration with boundary caps."""
    name: str
    tiers: List[FeeTier]
    min_fee: Optional[Decimal] = None
    max_fee: Optional[Decimal] = None
    is_marginal: bool = True  # True = progressive marginal fee; False = flat tier based on entire amount


@dataclass
class StatementSummaryResult:
    opening_balance: Decimal
    closing_balance: Decimal
    total_debits: Decimal
    total_credits: Decimal
    net_flow: Decimal
    transaction_count: int
    average_daily_balance: Optional[Decimal]
    discrepancy: Decimal = Decimal("0.0000")


@dataclass
class ReconciliationResult:
    is_balanced: bool
    system_total_debits: Decimal
    system_total_credits: Decimal
    external_total_cleared: Decimal
    net_difference: Decimal
    matched_records_count: int
    unmatched_system_records: List[Dict[str, Any]] = field(default_factory=list)
    unmatched_external_records: List[Dict[str, Any]] = field(default_factory=list)
    discrepancy_records: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class BenchmarkResult:
    iterations: int
    step_value: str
    float_final_sum: float
    float_expected_sum: float
    float_drift: float
    decimal_final_sum: Decimal
    decimal_expected_sum: Decimal
    decimal_drift: Decimal
    execution_time_ms: float
    precision_advantage: str


class FinancialCalculationEngine:
    """Core financial calculation engine employing strict Decimal math."""

    ROUNDING_MAP = {
        RoundingMode.HALF_EVEN: ROUND_HALF_EVEN,
        RoundingMode.HALF_UP: ROUND_HALF_UP,
        RoundingMode.DOWN: ROUND_DOWN,
        RoundingMode.UP: ROUND_UP,
    }

    @staticmethod
    def to_decimal(value: Any) -> Decimal:
        """Safely coerce any numeric or string representation into a precise Decimal."""
        if isinstance(value, Decimal):
            return value
        if value is None:
            raise ValueError("Cannot convert None to Decimal")
        try:
            return Decimal(str(value).strip())
        except Exception as e:
            raise ValueError(f"Invalid decimal value '{value}': {e}") from e

    @classmethod
    def quantize_currency(
        cls,
        amount: Decimal,
        decimals: int = 4,
        mode: RoundingMode = RoundingMode.HALF_EVEN
    ) -> Decimal:
        """Quantize an amount to a given number of decimal places using specified rounding."""
        exponent = Decimal("10") ** -decimals
        rounding = cls.ROUNDING_MAP.get(mode, ROUND_HALF_EVEN)
        return amount.quantize(exponent, rounding=rounding)

    @classmethod
    def calculate_tiered_fee(
        cls,
        amount: Any,
        schedule: TieredFeeSchedule,
        mode: RoundingMode = RoundingMode.HALF_EVEN,
        decimals: int = 4
    ) -> Tuple[Decimal, List[Dict[str, Any]]]:
        """
        Calculate tiered transaction fees using either marginal (bracketed)
        or flat tiered structure.
        """
        amt = cls.to_decimal(amount)
        if amt < Decimal("0"):
            raise ValueError("Transaction amount cannot be negative")
        if amt == Decimal("0"):
            return Decimal("0.0000"), []

        total_fee = Decimal("0")
        breakdown: List[Dict[str, Any]] = []

        if schedule.is_marginal:
            # Progressive marginal calculation across brackets
            remaining = amt
            for tier in schedule.tiers:
                if remaining <= Decimal("0"):
                    break

                tier_min = tier.min_amount
                tier_max = tier.max_amount

                if amt < tier_min:
                    continue

                # Portion of amount within this tier
                tier_capacity = (tier_max - tier_min) if tier_max is not None else remaining
                taxable_in_tier = min(remaining, tier_capacity)

                if taxable_in_tier > Decimal("0"):
                    tier_pct_fee = taxable_in_tier * (tier.percentage / Decimal("100"))
                    tier_fee = tier_pct_fee + tier.fixed_fee
                    total_fee += tier_fee
                    remaining -= taxable_in_tier

                    breakdown.append({
                        "tier_min": str(tier_min),
                        "tier_max": str(tier_max) if tier_max else "unlimited",
                        "taxable_amount": str(cls.quantize_currency(taxable_in_tier, decimals, mode)),
                        "rate_percent": str(tier.percentage),
                        "fixed_fee": str(tier.fixed_fee),
                        "fee_for_tier": str(cls.quantize_currency(tier_fee, decimals, mode)),
                    })
        else:
            # Flat tier selection based on total amount
            selected_tier: Optional[FeeTier] = None
            for tier in schedule.tiers:
                upper = tier.max_amount if tier.max_amount is not None else Decimal("Infinity")
                if tier.min_amount <= amt <= upper:
                    selected_tier = tier
                    break

            if selected_tier is None and schedule.tiers:
                selected_tier = schedule.tiers[-1]

            if selected_tier:
                total_fee = (amt * (selected_tier.percentage / Decimal("100"))) + selected_tier.fixed_fee
                breakdown.append({
                    "tier_min": str(selected_tier.min_amount),
                    "tier_max": str(selected_tier.max_amount) if selected_tier.max_amount else "unlimited",
                    "taxable_amount": str(amt),
                    "rate_percent": str(selected_tier.percentage),
                    "fixed_fee": str(selected_tier.fixed_fee),
                    "fee_for_tier": str(cls.quantize_currency(total_fee, decimals, mode)),
                })

        # Apply minimum fee cap if configured
        if schedule.min_fee is not None and total_fee < schedule.min_fee:
            total_fee = schedule.min_fee

        # Apply maximum fee cap if configured
        if schedule.max_fee is not None and total_fee > schedule.max_fee:
            total_fee = schedule.max_fee

        final_fee = cls.quantize_currency(total_fee, decimals, mode)
        return final_fee, breakdown

    @classmethod
    def calculate_interest_accrual(
        cls,
        principal: Any,
        annual_rate_percent: Any,
        days: int,
        method: InterestAccrualMethod = InterestAccrualMethod.DAILY_COMPOUND,
        day_count: DayCountConvention = DayCountConvention.ACT_365,
        mode: RoundingMode = RoundingMode.HALF_EVEN,
        decimals: int = 4
    ) -> Tuple[Decimal, Decimal]:
        """
        Calculate interest accrual and future value with strict Decimal precision.
        Returns: (accrued_interest, final_balance)
        """
        p = cls.to_decimal(principal)
        r_pct = cls.to_decimal(annual_rate_percent)

        if p < Decimal("0"):
            raise ValueError("Principal balance cannot be negative")
        if r_pct < Decimal("0"):
            raise ValueError("Annual interest rate cannot be negative")
        if days < 0:
            raise ValueError("Days elapsed cannot be negative")
        if days == 0 or p == Decimal("0") or r_pct == Decimal("0"):
            return Decimal("0.0000"), cls.quantize_currency(p, decimals, mode)

        rate = r_pct / Decimal("100")

        # Determine year basis
        if day_count == DayCountConvention.ACT_360:
            basis = Decimal("360")
        elif day_count == DayCountConvention.THIRTY_360:
            basis = Decimal("360")
        else:
            basis = Decimal("365")

        time_fraction = Decimal(str(days)) / basis

        if method == InterestAccrualMethod.SIMPLE:
            interest = p * rate * time_fraction
            final_balance = p + interest

        elif method == InterestAccrualMethod.DAILY_COMPOUND:
            daily_rate = rate / basis
            # (1 + r/n)^(n*t) where n*t = days
            compounded_factor = (Decimal("1") + daily_rate) ** days
            final_balance = p * compounded_factor
            interest = final_balance - p

        elif method == InterestAccrualMethod.MONTHLY_COMPOUND:
            months = Decimal(str(days)) / Decimal("30.41666666666666666666666667")
            monthly_rate = rate / Decimal("12")
            # Decimal exponentiation for monthly periods
            compounded_factor = (Decimal("1") + monthly_rate) ** int(months)
            final_balance = p * compounded_factor
            interest = final_balance - p

        elif method == InterestAccrualMethod.CONTINUOUS:
            # Continuous compounding: e^(rt) approximated with Decimal Taylor expansion
            rt = rate * time_fraction
            # exp(rt) = sum_{k=0}^{40} (rt)^k / k!
            e_rt = Decimal("1")
            term = Decimal("1")
            for k in range(1, 40):
                term = term * rt / Decimal(str(k))
                e_rt += term
                if abs(term) < Decimal("1e-25"):
                    break
            final_balance = p * e_rt
            interest = final_balance - p
        else:
            raise ValueError(f"Unsupported accrual method: {method}")

        accrued = cls.quantize_currency(interest, decimals, mode)
        total = cls.quantize_currency(final_balance, decimals, mode)
        return accrued, total

    @classmethod
    def calculate_statement_summary(
        cls,
        opening_balance: Any,
        transactions: List[Dict[str, Any]],
        days_in_period: int = 30,
        mode: RoundingMode = RoundingMode.HALF_EVEN,
        decimals: int = 4
    ) -> StatementSummaryResult:
        """
        Calculates exact statement financial metrics, net cash flow, and average daily balance.
        """
        open_bal = cls.to_decimal(opening_balance)
        running_bal = open_bal
        total_debits = Decimal("0")
        total_credits = Decimal("0")
        if days_in_period < 1:
            raise ValueError("Statement period must include at least one day")
        daily_changes: Dict[int, Decimal] = {}
        has_all_days = True

        for txn in transactions:
            amt = cls.to_decimal(txn.get("amount", 0))
            txn_type = str(txn.get("type", "")).lower()
            entry_type = str(txn.get("entry_type", "")).lower()

            before = running_bal
            if entry_type == "debit" or txn_type in ("withdrawal", "transfer", "payment"):
                total_debits += amt
                running_bal -= amt
            elif entry_type == "credit" or txn_type == "deposit":
                total_credits += amt
                running_bal += amt

            day = txn.get("day_of_period")
            if day is None:
                has_all_days = False
            elif not isinstance(day, int) or not 1 <= day <= days_in_period:
                raise ValueError("Transaction day is outside the statement period")
            else:
                daily_changes[day] = daily_changes.get(day, Decimal("0")) + running_bal - before

        net_flow = total_credits - total_debits
        closing_balance = open_bal + net_flow

        # Invariant check: closing_balance must exactly match running_bal
        discrepancy = abs(closing_balance - running_bal)

        # Average daily balance
        adb = None
        if has_all_days:
            weighted_balance = open_bal * days_in_period
            for day, change in daily_changes.items():
                weighted_balance += change * (days_in_period - day + 1)
            adb = cls.quantize_currency(weighted_balance / Decimal(days_in_period), decimals, mode)

        return StatementSummaryResult(
            opening_balance=cls.quantize_currency(open_bal, decimals, mode),
            closing_balance=cls.quantize_currency(closing_balance, decimals, mode),
            total_debits=cls.quantize_currency(total_debits, decimals, mode),
            total_credits=cls.quantize_currency(total_credits, decimals, mode),
            net_flow=cls.quantize_currency(net_flow, decimals, mode),
            transaction_count=len(transactions),
            average_daily_balance=adb,
            discrepancy=cls.quantize_currency(discrepancy, decimals, mode),
        )

    @classmethod
    def reconcile_batches(
        cls,
        system_records: List[Dict[str, Any]],
        external_records: List[Dict[str, Any]],
        decimals: int = 4
    ) -> ReconciliationResult:
        """
        Performs dual-source financial reconciliation between internal system ledger
        and external clearing batches with zero floating-point imprecision.
        """
        sys_debits = Decimal("0")
        sys_credits = Decimal("0")
        ext_cleared = Decimal("0")

        # Map external by reference_id or id
        ext_map: Dict[str, Dict[str, Any]] = {}
        for ext in external_records:
            ref = str(ext.get("reference_id") or ext.get("id"))
            ext_map[ref] = ext
            ext_amt = cls.to_decimal(ext.get("amount", 0))
            ext_cleared += ext_amt

        matched = 0
        unmatched_sys: List[Dict[str, Any]] = []
        discrepancies: List[Dict[str, Any]] = []
        matched_ext_keys = set()

        for sys in system_records:
            sys_amt = cls.to_decimal(sys.get("amount", 0))
            entry_type = str(sys.get("entry_type", "")).lower()

            if entry_type == "debit":
                sys_debits += sys_amt
            else:
                sys_credits += sys_amt

            ref = str(sys.get("reference_id") or sys.get("id") or sys.get("transaction_id"))
            if ref in ext_map:
                ext = ext_map[ref]
                ext_amt = cls.to_decimal(ext.get("amount", 0))
                diff = abs(sys_amt - ext_amt)
                matched_ext_keys.add(ref)

                if diff > Decimal("0.0000"):
                    discrepancies.append({
                        "reference_id": ref,
                        "system_amount": str(sys_amt),
                        "external_amount": str(ext_amt),
                        "difference": str(diff),
                    })
                else:
                    matched += 1
            else:
                unmatched_sys.append(sys)

        unmatched_ext = [ext for ref, ext in ext_map.items() if ref not in matched_ext_keys]

        net_difference = abs(sys_credits - ext_cleared)
        is_balanced = (
            net_difference == Decimal("0.0000")
            and len(unmatched_sys) == 0
            and len(unmatched_ext) == 0
            and len(discrepancies) == 0
        )

        return ReconciliationResult(
            is_balanced=is_balanced,
            system_total_debits=cls.quantize_currency(sys_debits, decimals),
            system_total_credits=cls.quantize_currency(sys_credits, decimals),
            external_total_cleared=cls.quantize_currency(ext_cleared, decimals),
            net_difference=cls.quantize_currency(net_difference, decimals),
            matched_records_count=matched,
            unmatched_system_records=unmatched_sys,
            unmatched_external_records=unmatched_ext,
            discrepancy_records=discrepancies,
        )

    @classmethod
    def run_precision_benchmark(cls, iterations: int = 100_000) -> BenchmarkResult:
        """
        Educational and verification benchmark proving that IEEE 754 binary floating-point
        produces accumulator drift, while Python Decimal guarantees exact correctness.
        """
        step_float = 0.1
        step_dec = Decimal("0.1")

        start = time.perf_counter()

        # Binary float summation
        float_sum = 0.0
        for _ in range(iterations):
            float_sum += step_float

        expected_float = iterations * step_float
        float_drift = abs(float_sum - expected_float)

        # Exact Decimal summation
        decimal_sum = Decimal("0")
        for _ in range(iterations):
            decimal_sum += step_dec

        expected_dec = Decimal(str(iterations)) * step_dec
        decimal_drift = abs(decimal_sum - expected_dec)

        elapsed_ms = (time.perf_counter() - start) * 1000.0

        return BenchmarkResult(
            iterations=iterations,
            step_value="0.1",
            float_final_sum=float_sum,
            float_expected_sum=expected_float,
            float_drift=float_drift,
            decimal_final_sum=decimal_sum,
            decimal_expected_sum=expected_dec,
            decimal_drift=decimal_drift,
            execution_time_ms=round(elapsed_ms, 2),
            precision_advantage="Decimal guarantees zero arithmetic accumulator drift (0.0000000000000000000000000000)"
        )
