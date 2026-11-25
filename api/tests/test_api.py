import json
from pathlib import Path

from fastapi.testclient import TestClient

from api.app.main import app

client = TestClient(app)
FIXTURES = Path(__file__).resolve().parents[2] / 'fixtures'


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding='utf-8'))


def test_health():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['ok'] is True


def test_validate_success_fixture():
    response = client.post('/validate', json=load_fixture('successful-calendar.json'))
    assert response.status_code == 200
    body = response.json()
    assert body['ok'] is True
    assert body['trace_id'] == 'sample-success-calendar'
    assert body['span_count'] == 7


def test_repeated_loop_detector():
    response = client.post('/detect/repeated-tool-loop', json=load_fixture('repeated-tool-loop.json'))
    assert response.status_code == 200
    findings = response.json()['findings']
    assert len(findings) == 1
    assert findings[0]['detector_id'] == 'D01'
    assert findings[0]['severity'] == 'high'
    assert len(findings[0]['evidence_span_ids']) == 5


def test_validate_rejects_missing_parent():
    trace = load_fixture('successful-calendar.json')
    trace['spans'][1]['parent_span_id'] = 'missing-parent'
    response = client.post('/validate', json=trace)
    assert response.status_code == 422
