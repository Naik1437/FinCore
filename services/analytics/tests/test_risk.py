import pytest
from datetime import datetime, timezone
from decimal import Decimal
from fastapi.testclient import TestClient

from app.main import app
from app.risk.engine import (
    RiskEvaluationEngine,
    RiskLevel,
    RiskDecision,
    AlertStatus,
    LEGAL_DISCLAIMER,
)


@pytest.fixture
def engine():
    return RiskEvaluationEngine()


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


# ============================================================================
# Core Risk Engine Unit Tests
# ============================================================================

def test_risk_scoring_low_tier(engine):
    result = engine.evaluate_transaction(
        wallet_id="WAL-001",
        amount=Decimal("150.00"),
        transaction_id="TX-LOW-01",
        timestamp=datetime(2026, 11, 24, 14, 0, 0, tzinfo=timezone.utc),
    )
    assert result.risk_level == RiskLevel.LOW
    assert result.recommended_decision == RiskDecision.APPROVE
    assert result.risk_score < 30
    assert result.disclaimer == LEGAL_DISCLAIMER
    assert len(engine.alerts) == 0


def test_risk_scoring_high_tier_and_alert_trigger(engine):
    # Combine high value ($25,000 = 35pts), round sum ($25,000 = 20pts),
    # and extreme historical deviation (30pts) to achieve score >= 70 (HIGH/CRITICAL)
    hist = [Decimal("100.00"), Decimal("120.00"), Decimal("110.00")]
    result = engine.evaluate_transaction(
        wallet_id="WAL-002",
        amount=Decimal("25000.00"),
        transaction_id="TX-HIGH-01",
        historical_amounts=hist,
        timestamp=datetime(2026, 11, 24, 14, 0, 0, tzinfo=timezone.utc),
    )
    assert result.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL)
    assert result.recommended_decision in (RiskDecision.MANUAL_REVIEW, RiskDecision.REJECT)
    assert result.risk_score >= 70
    assert result.disclaimer == LEGAL_DISCLAIMER
    # High-tier transaction triggers an operational risk alert
    assert len(engine.alerts) >= 1
    alert = next(iter(engine.alerts.values()))
    assert alert.transaction_id == "TX-HIGH-01"
    assert alert.status == AlertStatus.NEW


def test_velocity_spike_detection(engine):
    wallet_id = "WAL-VELOCITY-01"
    base_time = datetime(2026, 11, 24, 12, 0, 0, tzinfo=timezone.utc)

    # Record 4 rapid transactions within 2 minutes
    for _ in range(4):
        engine.record_transaction_history(
            wallet_id=wallet_id,
            amount=Decimal("100.00"),
            timestamp=base_time,
        )

    # 5th transaction evaluates against history and triggers velocity spike (>= 4 txns in 5 min)
    result = engine.evaluate_transaction(
        wallet_id=wallet_id,
        amount=Decimal("100.00"),
        transaction_id="TX-VEL-5",
        timestamp=base_time,
    )
    velocity_factors = [f for f in result.factors if f.rule_id == "RULE_VELOCITY_SPIKE"]
    assert len(velocity_factors) == 1
    assert velocity_factors[0].score_points > 0
    assert result.velocity_metrics["txns_last_5min"] >= 4


def test_anomaly_detection_z_score(engine):
    # Historical amounts around 100
    hist = [Decimal("95.00"), Decimal("105.00"), Decimal("100.00"), Decimal("102.00"), Decimal("98.00")]
    # Transaction amount is 1500, which is > 10x deviation
    result = engine.evaluate_transaction(
        wallet_id="WAL-ANOM-01",
        amount=Decimal("1500.00"),
        transaction_id="TX-ANOM-01",
        historical_amounts=hist,
        timestamp=datetime(2026, 11, 24, 14, 0, 0, tzinfo=timezone.utc),
    )
    anom_factors = [f for f in result.factors if f.rule_id == "RULE_ANOMALOUS_DEVIATION"]
    assert len(anom_factors) == 1
    assert anom_factors[0].score_points > 0


def test_round_sum_structuring(engine):
    # Round sum of $5,000 (>= 3,000 min qualifying and divisible by 1,000)
    result = engine.evaluate_transaction(
        wallet_id="WAL-STRUCT-01",
        amount=Decimal("5000.00"),
        transaction_id="TX-STRUCT-01",
        timestamp=datetime(2026, 11, 24, 14, 0, 0, tzinfo=timezone.utc),
    )
    structuring_factors = [f for f in result.factors if f.rule_id == "RULE_ROUND_SUM_STRUCTURING"]
    assert len(structuring_factors) == 1
    assert structuring_factors[0].score_points > 0


def test_new_beneficiary_burst(engine):
    wallet_id = "WAL-BEN-BURST"
    base_time = datetime(2026, 11, 24, 14, 0, 0, tzinfo=timezone.utc)

    # Record 2 recent prior transfers to different beneficiaries in the last 15 min
    engine.record_transaction_history(wallet_id, Decimal("50.00"), base_time, beneficiary_id="BEN-01")
    engine.record_transaction_history(wallet_id, Decimal("50.00"), base_time, beneficiary_id="BEN-02")

    # Evaluate transfer to another new recipient (beneficiary burst >= 2)
    result = engine.evaluate_transaction(
        wallet_id=wallet_id,
        amount=Decimal("500.00"),
        is_new_beneficiary=True,
        beneficiary_id="BEN-999",
        transaction_id="TX-NEWBEN-01",
        timestamp=base_time,
    )
    new_ben_factors = [f for f in result.factors if f.rule_id == "RULE_NEW_BENEFICIARY_BURST"]
    assert len(new_ben_factors) == 1
    assert new_ben_factors[0].score_points > 0


def test_off_hours_activity(engine):
    # 03:30 UTC is off-hours (between 01:00 and 05:00) with amount >= $1,500
    result = engine.evaluate_transaction(
        wallet_id="WAL-NIGHT-01",
        amount=Decimal("2500.00"),
        transaction_id="TX-NIGHT-01",
        timestamp=datetime(2026, 11, 24, 3, 30, 0, tzinfo=timezone.utc),
    )
    off_hours_factors = [f for f in result.factors if f.rule_id == "RULE_OFF_HOURS_ACTIVITY"]
    assert len(off_hours_factors) == 1
    assert off_hours_factors[0].score_points > 0


def test_explainable_scoring_and_transparency(engine):
    result = engine.evaluate_transaction(
        wallet_id="WAL-EXP-01",
        amount=Decimal("25000.00"),
        transaction_id="TX-EXP-01",
        timestamp=datetime(2026, 11, 24, 3, 0, 0, tzinfo=timezone.utc),
    )
    assert len(result.factors) >= 2
    for factor in result.factors:
        assert factor.rule_id.startswith("RULE_")
        assert len(factor.rule_name) > 0
        assert factor.score_points > 0
        assert len(factor.reason) > 0
    assert result.disclaimer == LEGAL_DISCLAIMER


# ============================================================================
# FastAPI Route Endpoints Tests
# ============================================================================

def test_api_risk_evaluate_endpoint(client):
    payload = {
        "wallet_id": "WAL-API-01",
        "amount": "250.00",
        "currency": "USD",
        "transaction_id": "TX-API-01",
        "is_new_beneficiary": False,
    }
    response = client.post("/api/v1/risk/evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["transaction_id"] == "TX-API-01"
    assert "risk_score" in data
    assert "risk_level" in data
    assert "recommended_decision" in data
    assert "factors" in data
    assert "velocity_metrics" in data
    assert data["disclaimer"] == LEGAL_DISCLAIMER


def test_api_risk_batch_evaluate_endpoint(client):
    payload = [
        {
            "wallet_id": "WAL-BATCH-01",
            "amount": "100.00",
            "transaction_id": "TX-BATCH-01",
        },
        {
            "wallet_id": "WAL-BATCH-01",
            "amount": "25000.00",
            "transaction_id": "TX-BATCH-02",
        },
    ]
    response = client.post("/api/v1/risk/batch", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["total_evaluated"] == 2
    assert len(data["evaluations"]) == 2


def test_api_risk_rules_catalog_and_update(client):
    # GET rules
    get_res = client.get("/api/v1/risk/rules")
    assert get_res.status_code == 200
    res_data = get_res.json()
    assert res_data["status"] == "success"
    rules = res_data["rules"]
    assert len(rules) >= 6
    rule_ids = [r["id"] for r in rules]
    assert "RULE_HIGH_VALUE" in rule_ids

    # PATCH rule weight
    patch_res = client.patch(
        "/api/v1/risk/rules/RULE_HIGH_VALUE",
        json={"weight": 55}
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["status"] == "success"
    assert updated["rule"]["weight"] == 55


def test_api_risk_alerts_and_adjudication(client):
    # Trigger a high risk transaction that creates an alert
    # High value (35) + round sum 25000 (20) + extreme anomaly (30) = 85 (HIGH)
    client.post("/api/v1/risk/evaluate", json={
        "wallet_id": "WAL-ALERT-01",
        "amount": "25000.00",
        "transaction_id": "TX-ALERT-TEST-01",
        "historical_amounts": ["100.00", "120.00", "110.00"],
    })

    # Query alerts
    alerts_res = client.get("/api/v1/risk/alerts")
    assert alerts_res.status_code == 200
    res_data = alerts_res.json()
    assert res_data["status"] == "success"
    alerts = res_data["alerts"]
    assert len(alerts) >= 1

    target_alert = alerts[0]
    alert_id = target_alert["id"]

    # Adjudicate alert
    adj_res = client.patch(
        f"/api/v1/risk/alerts/{alert_id}",
        json={
            "status": "RESOLVED_LEGITIMATE",
            "reviewer_notes": "Customer confirmed high value wire transfer via phone verification.",
        }
    )
    assert adj_res.status_code == 200
    adj_data = adj_res.json()
    assert adj_data["status"] == "success"
    assert adj_data["alert"]["status"] == "RESOLVED_LEGITIMATE"
    assert "Customer confirmed" in adj_data["alert"]["reviewer_notes"]


def test_api_risk_summary_operations_report(client):
    res = client.get("/api/v1/risk/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    summary = data["summary"]
    assert "total_alerts" in summary
    assert "high_risk_alerts" in summary
    assert "configured_rules_count" in summary
    assert summary["configured_rules_count"] >= 6
    assert summary["disclaimer"] == LEGAL_DISCLAIMER
