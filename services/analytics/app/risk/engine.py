"""FinCore Transaction Risk Scoring, Velocity & Anomaly Detection Engine.

Assessment 06: FastAPI Risk Analytics
Provides decision-support risk analytics, velocity tracking, configurable rules,
and explainable scoring for operations and compliance teams.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
import math
import uuid
from typing import Any, Dict, List, Optional, Tuple


class RiskLevel(str, Enum):
    LOW = "LOW"            # Score 0 - 29: Normal activity
    MEDIUM = "MEDIUM"      # Score 30 - 69: Elevated scrutiny / step-up auth
    HIGH = "HIGH"          # Score 70 - 89: Suspicious / manual operations review
    CRITICAL = "CRITICAL"  # Score 90 - 100: High confidence anomaly / block


class RiskDecision(str, Enum):
    APPROVE = "APPROVE"
    STEP_UP_AUTH = "STEP_UP_AUTH"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    REJECT = "REJECT"


class AlertStatus(str, Enum):
    NEW = "NEW"
    IN_REVIEW = "IN_REVIEW"
    RESOLVED_LEGITIMATE = "RESOLVED_LEGITIMATE"
    RESOLVED_FRAUDULENT = "RESOLVED_FRAUDULENT"
    DISMISSED = "DISMISSED"


@dataclass
class RiskFactor:
    rule_id: str
    rule_name: str
    score_points: int
    severity: RiskLevel
    reason: str
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RiskRule:
    id: str
    name: str
    description: str
    weight: int  # Max points this rule can add (0 - 100)
    enabled: bool = True
    parameters: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RiskEvaluationResult:
    evaluation_id: str
    transaction_id: Optional[str]
    wallet_id: str
    amount: Decimal
    currency: str
    risk_score: int  # 0 to 100
    risk_level: RiskLevel
    recommended_decision: RiskDecision
    factors: List[RiskFactor]
    velocity_metrics: Dict[str, Any]
    anomaly_metrics: Dict[str, Any]
    disclaimer: str
    evaluated_at: str


@dataclass
class RiskAlert:
    id: str
    evaluation_id: str
    transaction_id: Optional[str]
    wallet_id: str
    risk_score: int
    risk_level: RiskLevel
    status: AlertStatus
    factors_summary: List[str]
    reviewer_notes: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


LEGAL_DISCLAIMER = (
    "Risk scores represent automated statistical decision support and algorithmic heuristics, "
    "not definitive legal proof of fraud or illicit activity. All scores must be reviewed in "
    "context by authorized operations analysts before adverse action is taken."
)


class RiskEvaluationEngine:
    """Configurable risk analytics engine for transaction evaluation."""

    def __init__(self) -> None:
        self.rules: Dict[str, RiskRule] = self._init_default_rules()
        self.alerts: Dict[str, RiskAlert] = {}
        # Simple in-memory velocity cache (per wallet_id): list of timestamps and amounts
        self._velocity_history: Dict[str, List[Tuple[datetime, Decimal, Optional[str]]]] = {}

    def _init_default_rules(self) -> Dict[str, RiskRule]:
        return {
            "RULE_HIGH_VALUE": RiskRule(
                id="RULE_HIGH_VALUE",
                name="High Value Transaction",
                description="Flags transactions that exceed standard high-value monitoring thresholds.",
                weight=35,
                parameters={
                    "tier_1_threshold": Decimal("5000.00"),
                    "tier_1_points": 20,
                    "tier_2_threshold": Decimal("20000.00"),
                    "tier_2_points": 35,
                },
            ),
            "RULE_VELOCITY_SPIKE": RiskRule(
                id="RULE_VELOCITY_SPIKE",
                name="Transaction Velocity Spike",
                description="Detects rapid successive transactions within short rolling time windows.",
                weight=40,
                parameters={
                    "window_1_minutes": 5,
                    "window_1_max_txns": 4,
                    "window_1_points": 35,
                    "window_2_hours": 1,
                    "window_2_max_txns": 12,
                    "window_2_points": 25,
                },
            ),
            "RULE_ANOMALOUS_DEVIATION": RiskRule(
                id="RULE_ANOMALOUS_DEVIATION",
                name="Historical Amount Anomaly",
                description="Identifies amounts that deviate significantly (>3x) from customer historical mean.",
                weight=30,
                parameters={
                    "multiplier_threshold": Decimal("3.0"),
                    "extreme_multiplier": Decimal("8.0"),
                    "min_history_count": 3,
                },
            ),
            "RULE_ROUND_SUM_STRUCTURING": RiskRule(
                id="RULE_ROUND_SUM_STRUCTURING",
                name="Round Sum Structuring Pattern",
                description="Detects large round transaction amounts commonly associated with smurfing/structuring.",
                weight=15,
                parameters={
                    "round_modulo": Decimal("1000.00"),
                    "min_qualifying_amount": Decimal("3000.00"),
                },
            ),
            "RULE_NEW_BENEFICIARY_BURST": RiskRule(
                id="RULE_NEW_BENEFICIARY_BURST",
                name="Rapid New Beneficiary Transfers",
                description="Flags multiple rapid transfers directed to newly added beneficiaries.",
                weight=30,
                parameters={
                    "max_new_beneficiaries": 2,
                    "window_minutes": 15,
                },
            ),
            "RULE_OFF_HOURS_ACTIVITY": RiskRule(
                id="RULE_OFF_HOURS_ACTIVITY",
                name="Off-Hours High-Risk Activity",
                description="Flags large transactions executed during atypical early-morning hours (01:00 - 05:00 UTC).",
                weight=15,
                parameters={
                    "start_hour": 1,
                    "end_hour": 5,
                    "min_amount": Decimal("1500.00"),
                },
            ),
        }

    def record_transaction_history(
        self,
        wallet_id: str,
        amount: Decimal,
        timestamp: Optional[datetime] = None,
        beneficiary_id: Optional[str] = None
    ) -> None:
        """Stores historical event for rolling velocity and statistical baselines."""
        ts = timestamp or datetime.now(timezone.utc)
        if wallet_id not in self._velocity_history:
            self._velocity_history[wallet_id] = []
        self._velocity_history[wallet_id].append((ts, amount, beneficiary_id))

    def evaluate_transaction(
        self,
        wallet_id: str,
        amount: Any,
        currency: str = "USD",
        transaction_id: Optional[str] = None,
        beneficiary_id: Optional[str] = None,
        is_new_beneficiary: bool = False,
        historical_amounts: Optional[List[Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> RiskEvaluationResult:
        """
        Calculates an explainable risk score (0-100) for an incoming transaction.
        Evaluates velocity, anomalies, rule triggers, and produces actionable decision recommendations.
        """
        amt = Decimal(str(amount).strip())
        if amt < Decimal("0"):
            raise ValueError("Transaction amount cannot be negative")

        eval_time = timestamp or datetime.now(timezone.utc)
        factors: List[RiskFactor] = []
        raw_score = 0

        # Retrieve wallet rolling history
        history = self._velocity_history.get(wallet_id, [])

        # ------------------------------------------------------------------
        # 1. Rule: High Value Transaction
        # ------------------------------------------------------------------
        rule_high = self.rules.get("RULE_HIGH_VALUE")
        if rule_high and rule_high.enabled:
            t1 = rule_high.parameters.get("tier_1_threshold", Decimal("5000.00"))
            t2 = rule_high.parameters.get("tier_2_threshold", Decimal("20000.00"))
            p1 = rule_high.parameters.get("tier_1_points", 20)
            p2 = rule_high.parameters.get("tier_2_points", 35)

            if amt >= t2:
                points = min(p2, rule_high.weight)
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_high.id,
                    rule_name=rule_high.name,
                    score_points=points,
                    severity=RiskLevel.HIGH,
                    reason=f"Transaction amount of {amt} {currency} exceeds Tier-2 threshold of {t2} {currency}.",
                    metadata={"amount": str(amt), "threshold": str(t2)},
                ))
            elif amt >= t1:
                points = min(p1, rule_high.weight)
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_high.id,
                    rule_name=rule_high.name,
                    score_points=points,
                    severity=RiskLevel.MEDIUM,
                    reason=f"Transaction amount of {amt} {currency} exceeds Tier-1 threshold of {t1} {currency}.",
                    metadata={"amount": str(amt), "threshold": str(t1)},
                ))

        # ------------------------------------------------------------------
        # 2. Rule: Velocity Spike
        # ------------------------------------------------------------------
        rule_velocity = self.rules.get("RULE_VELOCITY_SPIKE")
        txns_last_5min = 0
        txns_last_1hr = 0
        volume_last_1hr = Decimal("0")

        for h_time, h_amt, _ in history:
            delta_seconds = (eval_time - h_time).total_seconds()
            if 0 <= delta_seconds <= 300:  # 5 minutes
                txns_last_5min += 1
            if 0 <= delta_seconds <= 3600:  # 1 hour
                txns_last_1hr += 1
                volume_last_1hr += h_amt

        if rule_velocity and rule_velocity.enabled:
            w1_max = rule_velocity.parameters.get("window_1_max_txns", 4)
            w1_pts = rule_velocity.parameters.get("window_1_points", 35)
            w2_max = rule_velocity.parameters.get("window_2_max_txns", 12)
            w2_pts = rule_velocity.parameters.get("window_2_points", 25)

            if txns_last_5min >= w1_max:
                points = min(w1_pts, rule_velocity.weight)
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_velocity.id,
                    rule_name=rule_velocity.name,
                    score_points=points,
                    severity=RiskLevel.HIGH,
                    reason=f"Rapid velocity: {txns_last_5min} transactions recorded within past 5 minutes (max threshold: {w1_max}).",
                    metadata={"window": "5m", "count": txns_last_5min},
                ))
            elif txns_last_1hr >= w2_max:
                points = min(w2_pts, rule_velocity.weight)
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_velocity.id,
                    rule_name=rule_velocity.name,
                    score_points=points,
                    severity=RiskLevel.MEDIUM,
                    reason=f"High hourly velocity: {txns_last_1hr} transactions recorded within past hour (max threshold: {w2_max}).",
                    metadata={"window": "1h", "count": txns_last_1hr},
                ))

        # ------------------------------------------------------------------
        # 3. Rule: Anomalous Historical Deviation (Z-score / Multiplier)
        # ------------------------------------------------------------------
        rule_anomaly = self.rules.get("RULE_ANOMALOUS_DEVIATION")
        effective_history = [Decimal(str(x)) for x in (historical_amounts or [h[1] for h in history])]

        historical_mean = Decimal("0")
        std_dev = Decimal("0")
        z_score = 0.0

        if effective_history:
            historical_mean = sum(effective_history) / Decimal(str(len(effective_history)))
            if len(effective_history) >= 2:
                variance = sum((x - historical_mean) ** 2 for x in effective_history) / Decimal(str(len(effective_history) - 1))
                std_dev = Decimal(str(math.sqrt(float(variance))))
                if std_dev > Decimal("0"):
                    z_score = float((amt - historical_mean) / std_dev)

        if rule_anomaly and rule_anomaly.enabled and len(effective_history) >= rule_anomaly.parameters.get("min_history_count", 3):
            multiplier = amt / historical_mean if historical_mean > Decimal("0") else Decimal("1")
            thresh = rule_anomaly.parameters.get("multiplier_threshold", Decimal("3.0"))
            extreme = rule_anomaly.parameters.get("extreme_multiplier", Decimal("8.0"))

            if multiplier >= extreme:
                points = rule_anomaly.weight
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_anomaly.id,
                    rule_name=rule_anomaly.name,
                    score_points=points,
                    severity=RiskLevel.HIGH,
                    reason=f"Extreme anomaly: Amount is {multiplier:.1f}x the customer's historical average of {historical_mean:.2f} {currency} (z-score: {z_score:.2f}).",
                    metadata={"multiplier": str(multiplier), "mean": str(historical_mean), "z_score": z_score},
                ))
            elif multiplier >= thresh:
                points = int(rule_anomaly.weight * 0.6)
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_anomaly.id,
                    rule_name=rule_anomaly.name,
                    score_points=points,
                    severity=RiskLevel.MEDIUM,
                    reason=f"Elevated amount: Amount is {multiplier:.1f}x the customer's historical average of {historical_mean:.2f} {currency}.",
                    metadata={"multiplier": str(multiplier), "mean": str(historical_mean)},
                ))

        # ------------------------------------------------------------------
        # 4. Rule: Round Sum Structuring Pattern
        # ------------------------------------------------------------------
        rule_round = self.rules.get("RULE_ROUND_SUM_STRUCTURING")
        if rule_round and rule_round.enabled:
            min_qualifying = rule_round.parameters.get("min_qualifying_amount", Decimal("3000.00"))
            modulo = rule_round.parameters.get("round_modulo", Decimal("1000.00"))

            if amt >= min_qualifying and (amt % modulo) == Decimal("0"):
                points = rule_round.weight
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_round.id,
                    rule_name=rule_round.name,
                    score_points=points,
                    severity=RiskLevel.MEDIUM,
                    reason=f"Large round sum ({amt} {currency}): Round transaction pattern common in structured fund transfers.",
                    metadata={"amount": str(amt)},
                ))

        # ------------------------------------------------------------------
        # 5. Rule: New Beneficiary Burst
        # ------------------------------------------------------------------
        rule_ben = self.rules.get("RULE_NEW_BENEFICIARY_BURST")
        if rule_ben and rule_ben.enabled and is_new_beneficiary:
            # Check how many recent transfers went to other new beneficiaries in 15 min
            recent_ben_count = 0
            for h_time, _, b_id in history:
                if (eval_time - h_time).total_seconds() <= 900 and b_id != beneficiary_id:
                    recent_ben_count += 1

            if recent_ben_count >= rule_ben.parameters.get("max_new_beneficiaries", 2):
                points = rule_ben.weight
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_ben.id,
                    rule_name=rule_ben.name,
                    score_points=points,
                    severity=RiskLevel.HIGH,
                    reason=f"Beneficiary surge: Transfer to new recipient after {recent_ben_count} other new recipient transfers in past 15 min.",
                    metadata={"recent_new_beneficiaries": recent_ben_count},
                ))

        # ------------------------------------------------------------------
        # 6. Rule: Off-Hours Activity
        # ------------------------------------------------------------------
        rule_hours = self.rules.get("RULE_OFF_HOURS_ACTIVITY")
        if rule_hours and rule_hours.enabled:
            hour = eval_time.hour
            start_h = rule_hours.parameters.get("start_hour", 1)
            end_h = rule_hours.parameters.get("end_hour", 5)
            min_amt = rule_hours.parameters.get("min_amount", Decimal("1500.00"))

            if start_h <= hour <= end_h and amt >= min_amt:
                points = rule_hours.weight
                raw_score += points
                factors.append(RiskFactor(
                    rule_id=rule_hours.id,
                    rule_name=rule_hours.name,
                    score_points=points,
                    severity=RiskLevel.LOW,
                    reason=f"Off-hours transfer of {amt} {currency} executed between {start_h:02d}:00 and {end_h:02d}:00 UTC.",
                    metadata={"hour": hour, "amount": str(amt)},
                ))

        # ------------------------------------------------------------------
        # Calculate Final Score & Decision
        # ------------------------------------------------------------------
        final_score = min(100, max(0, raw_score))

        if final_score >= 90:
            level = RiskLevel.CRITICAL
            decision = RiskDecision.REJECT
        elif final_score >= 70:
            level = RiskLevel.HIGH
            decision = RiskDecision.MANUAL_REVIEW
        elif final_score >= 30:
            level = RiskLevel.MEDIUM
            decision = RiskDecision.STEP_UP_AUTH
        else:
            level = RiskLevel.LOW
            decision = RiskDecision.APPROVE

        eval_id = str(uuid.uuid4())

        # Automatically create alert for High or Critical transactions
        if level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
            alert = RiskAlert(
                id=str(uuid.uuid4()),
                evaluation_id=eval_id,
                transaction_id=transaction_id,
                wallet_id=wallet_id,
                risk_score=final_score,
                risk_level=level,
                status=AlertStatus.NEW,
                factors_summary=[f.reason for f in factors],
            )
            self.alerts[alert.id] = alert

        # Automatically append to velocity history
        self.record_transaction_history(wallet_id, amt, eval_time, beneficiary_id)

        return RiskEvaluationResult(
            evaluation_id=eval_id,
            transaction_id=transaction_id,
            wallet_id=wallet_id,
            amount=amt,
            currency=currency,
            risk_score=final_score,
            risk_level=level,
            recommended_decision=decision,
            factors=factors,
            velocity_metrics={
                "txns_last_5min": txns_last_5min + 1,
                "txns_last_1hr": txns_last_1hr + 1,
                "volume_last_1hr": str(volume_last_1hr + amt),
            },
            anomaly_metrics={
                "historical_mean": str(historical_mean),
                "z_score": round(z_score, 2),
                "sample_size": len(effective_history),
            },
            disclaimer=LEGAL_DISCLAIMER,
            evaluated_at=eval_time.isoformat(),
        )

    def get_alerts(
        self,
        status: Optional[AlertStatus] = None,
        severity: Optional[RiskLevel] = None,
    ) -> List[RiskAlert]:
        """Query risk alerts with status and severity filters."""
        results = list(self.alerts.values())
        if status:
            results = [a for a in results if a.status == status]
        if severity:
            results = [a for a in results if a.risk_level == severity]
        # Return sorted by newest
        results.sort(key=lambda a: a.created_at, reverse=True)
        return results

    def adjudicate_alert(
        self,
        alert_id: str,
        new_status: AlertStatus,
        reviewer_notes: Optional[str] = None
    ) -> RiskAlert:
        """Adjudicates a pending risk alert with compliance notes."""
        if alert_id not in self.alerts:
            raise KeyError(f"Risk alert '{alert_id}' not found")
        alert = self.alerts[alert_id]
        alert.status = new_status
        if reviewer_notes:
            alert.reviewer_notes = reviewer_notes
        alert.updated_at = datetime.now(timezone.utc).isoformat()
        return alert

    def get_operations_summary(self) -> Dict[str, Any]:
        """Provides high-level risk overview telemetry for Operations and Risk dashboards."""
        total_alerts = len(self.alerts)
        new_alerts = sum(1 for a in self.alerts.values() if a.status == AlertStatus.NEW)
        critical_alerts = sum(1 for a in self.alerts.values() if a.risk_level == RiskLevel.CRITICAL)
        high_alerts = sum(1 for a in self.alerts.values() if a.risk_level == RiskLevel.HIGH)

        return {
            "total_alerts": total_alerts,
            "new_alerts": new_alerts,
            "critical_risk_alerts": critical_alerts,
            "high_risk_alerts": high_alerts,
            "configured_rules_count": len(self.rules),
            "disclaimer": LEGAL_DISCLAIMER,
        }


# Singleton engine instance for analytics service
risk_engine = RiskEvaluationEngine()
