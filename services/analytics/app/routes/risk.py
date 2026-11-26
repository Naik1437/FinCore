"""FastAPI Routes for Risk Analytics & Anomaly Detection.

Assessment 06: FastAPI Risk Analytics
"""
from decimal import Decimal
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.risk.engine import (
    RiskLevel,
    AlertStatus,
    risk_engine,
)

router = APIRouter()


class EvaluateTransactionRequest(BaseModel):
    wallet_id: str = Field(..., description="Wallet UUID initiating the transaction")
    amount: str = Field(..., description="Transaction monetary amount")
    currency: str = Field("USD", description="3-letter ISO currency code")
    transaction_id: Optional[str] = Field(None, description="Optional transaction UUID")
    beneficiary_id: Optional[str] = Field(None, description="Optional beneficiary UUID")
    is_new_beneficiary: bool = Field(False, description="Flag indicating first transfer to this recipient")
    historical_amounts: Optional[List[str]] = Field(None, description="Optional historical transaction amounts")


class RuleUpdateRequest(BaseModel):
    weight: Optional[int] = Field(None, ge=0, le=100, description="Rule weight points")
    enabled: Optional[bool] = Field(None, description="Toggle rule active state")


class AlertAdjudicationRequest(BaseModel):
    status: AlertStatus = Field(..., description="New adjudication status")
    reviewer_notes: Optional[str] = Field(None, description="Compliance / operations analyst notes")


@router.post("/evaluate")
async def evaluate_transaction(req: EvaluateTransactionRequest) -> Dict[str, Any]:
    """
    Evaluates incoming transaction against velocity, anomalies, and risk heuristics.
    Returns explainable score (0-100), risk tier, decision recommendation, and compliance disclaimer.
    """
    try:
        hist = [Decimal(a) for a in req.historical_amounts] if req.historical_amounts else None
        res = risk_engine.evaluate_transaction(
            wallet_id=req.wallet_id,
            amount=req.amount,
            currency=req.currency,
            transaction_id=req.transaction_id,
            beneficiary_id=req.beneficiary_id,
            is_new_beneficiary=req.is_new_beneficiary,
            historical_amounts=hist,
        )

        return {
            "status": "success",
            "evaluation_id": res.evaluation_id,
            "transaction_id": res.transaction_id,
            "wallet_id": res.wallet_id,
            "amount": str(res.amount),
            "currency": res.currency,
            "risk_score": res.risk_score,
            "risk_level": res.risk_level.value,
            "recommended_decision": res.recommended_decision.value,
            "factors": [
                {
                    "rule_id": f.rule_id,
                    "rule_name": f.rule_name,
                    "score_points": f.score_points,
                    "severity": f.severity.value,
                    "reason": f.reason,
                    "metadata": f.metadata,
                }
                for f in res.factors
            ],
            "velocity_metrics": res.velocity_metrics,
            "anomaly_metrics": res.anomaly_metrics,
            "disclaimer": res.disclaimer,
            "evaluated_at": res.evaluated_at,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Risk evaluation error: {e}") from e


@router.post("/batch")
async def evaluate_batch(transactions: List[EvaluateTransactionRequest]) -> Dict[str, Any]:
    """Evaluates a batch of transactions and returns aggregated risk metrics."""
    results = []
    high_risk_count = 0

    for req in transactions:
        try:
            hist = [Decimal(a) for a in req.historical_amounts] if req.historical_amounts else None
            res = risk_engine.evaluate_transaction(
                wallet_id=req.wallet_id,
                amount=req.amount,
                currency=req.currency,
                transaction_id=req.transaction_id,
                beneficiary_id=req.beneficiary_id,
                is_new_beneficiary=req.is_new_beneficiary,
                historical_amounts=hist,
            )
            if res.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
                high_risk_count += 1
            results.append({
                "wallet_id": res.wallet_id,
                "amount": str(res.amount),
                "risk_score": res.risk_score,
                "risk_level": res.risk_level.value,
                "recommended_decision": res.recommended_decision.value,
                "factors_count": len(res.factors),
            })
        except Exception as e:
            results.append({"wallet_id": req.wallet_id, "error": str(e)})

    return {
        "status": "success",
        "total_evaluated": len(transactions),
        "high_risk_count": high_risk_count,
        "evaluations": results,
    }


@router.get("/rules")
async def list_rules() -> Dict[str, Any]:
    """Lists all configurable risk detection rules and current threshold parameters."""
    return {
        "status": "success",
        "rules": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "weight": r.weight,
                "enabled": r.enabled,
                "parameters": {k: str(v) if isinstance(v, Decimal) else v for k, v in r.parameters.items()},
            }
            for r in risk_engine.rules.values()
        ],
    }


@router.patch("/rules/{rule_id}")
async def update_rule(rule_id: str, req: RuleUpdateRequest) -> Dict[str, Any]:
    """Updates rule active status and point weight."""
    if rule_id not in risk_engine.rules:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Rule '{rule_id}' not found")

    rule = risk_engine.rules[rule_id]
    if req.weight is not None:
        rule.weight = req.weight
    if req.enabled is not None:
        rule.enabled = req.enabled

    return {
        "status": "success",
        "message": f"Rule '{rule_id}' updated successfully",
        "rule": {
            "id": rule.id,
            "name": rule.name,
            "weight": rule.weight,
            "enabled": rule.enabled,
        },
    }


@router.get("/alerts")
async def list_alerts(
    alert_status: Optional[AlertStatus] = Query(None, alias="status"),
    severity: Optional[RiskLevel] = None,
) -> Dict[str, Any]:
    """Query risk alerts triggered by high or critical severity evaluations."""
    alerts = risk_engine.get_alerts(status=alert_status, severity=severity)
    return {
        "status": "success",
        "count": len(alerts),
        "alerts": [
            {
                "id": a.id,
                "evaluation_id": a.evaluation_id,
                "transaction_id": a.transaction_id,
                "wallet_id": a.wallet_id,
                "risk_score": a.risk_score,
                "risk_level": a.risk_level.value,
                "status": a.status.value,
                "factors_summary": a.factors_summary,
                "reviewer_notes": a.reviewer_notes,
                "created_at": a.created_at,
                "updated_at": a.updated_at,
            }
            for a in alerts
        ],
    }


@router.patch("/alerts/{alert_id}")
async def adjudicate_alert(alert_id: str, req: AlertAdjudicationRequest) -> Dict[str, Any]:
    """Adjudicates a pending risk alert with reviewer compliance notes."""
    try:
        updated = risk_engine.adjudicate_alert(
            alert_id=alert_id,
            new_status=req.status,
            reviewer_notes=req.reviewer_notes,
        )
        return {
            "status": "success",
            "message": "Alert adjudicated successfully",
            "alert": {
                "id": updated.id,
                "status": updated.status.value,
                "reviewer_notes": updated.reviewer_notes,
                "updated_at": updated.updated_at,
            },
        }
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.get("/summary")
async def operations_summary() -> Dict[str, Any]:
    """Operations risk overview report."""
    summary = risk_engine.get_operations_summary()
    return {"status": "success", "summary": summary}
