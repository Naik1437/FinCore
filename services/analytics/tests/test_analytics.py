import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import app


def test_settings_debug_release_parsing():
    s = Settings(DEBUG="release")
    assert s.DEBUG is False


def test_settings_debug_boolean_and_string():
    assert Settings(DEBUG=True).DEBUG is True
    assert Settings(DEBUG=False).DEBUG is False
    assert Settings(DEBUG="1").DEBUG is True
    assert Settings(DEBUG="0").DEBUG is False
    assert Settings(DEBUG="debug").DEBUG is True
    assert Settings(DEBUG="prod").DEBUG is False


def test_settings_database_url_asyncpg_coercion():
    s = Settings(DATABASE_URL="postgresql://user:pass@localhost:5432/db")
    assert s.DATABASE_URL == "postgresql+asyncpg://user:pass@localhost:5432/db"

    s2 = Settings(DATABASE_URL="postgres://user:pass@localhost:5432/db")
    assert s2.DATABASE_URL == "postgresql+asyncpg://user:pass@localhost:5432/db"

    s3 = Settings(DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/db")
    assert s3.DATABASE_URL == "postgresql+asyncpg://user:pass@localhost:5432/db"


def test_root_endpoint():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "FinCore Analytics"
        assert data["version"] == "1.0.0"


def test_health_live_endpoint():
    with TestClient(app) as client:
        response = client.get("/health/live")
        assert response.status_code == 200
        assert response.json() == {"status": "alive"}


def test_health_endpoint_structure():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code in (200, 503)
        data = response.json()
        assert "status" in data
        assert "services" in data
        assert "database" in data["services"]
        assert "redis" in data["services"]


def test_analytics_summary_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/v1/analytics/summary")
        assert response.status_code == 200
        data = response.json()
        assert "period" in data
        assert "wallets" in data
        assert "transactions" in data
        assert "ledger" in data


def test_metrics_transaction_volume():
    with TestClient(app) as client:
        response = client.get("/api/v1/metrics/transaction-volume")
        assert response.status_code == 200
        data = response.json()
        assert data["metric"] == "transaction_volume"
        assert data["aggregation"] == "1h"
