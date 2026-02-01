"""
Doctor Portal API — Flask backend for the physician dashboard.

This is the ONE component that sees across all patient containers.
It reads the patient registry (shared with the SMS Router) and
proxies requests to individual ClawBox containers.

Routes:
  GET  /api/dashboard          → summary of all patients
  GET  /api/patients           → list all patients with status
  GET  /api/patients/:id       → full patient detail (proxied to container)
  GET  /api/patients/:id/alerts     → alerts for a patient
  POST /api/patients/:id/alerts/:aid/ack → acknowledge an alert
  GET  /api/patients/:id/vitals     → vitals history
  GET  /api/patients/:id/medications → medication list
  GET  /api/patients/:id/adherence  → adherence stats
  GET  /api/patients/:id/conversations → conversation log
  POST /api/patients/:id/message    → send message through bot
  GET  /health                      → health check
"""

import json
import os

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__, static_folder="../frontend/dist", static_url_path="/")
CORS(app)

REGISTRY_PATH = os.environ.get("REGISTRY_PATH", "/data/registry/patients.json")
CLAWBOX_NETWORK = "clawhealth"  # Docker network name


def load_registry():
    """Load the patient registry (shared JSON file with SMS Router)."""
    try:
        with open(REGISTRY_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"patients": [], "nextPort": 18790}


def get_patient(patient_id):
    """Find a patient entry in the registry."""
    registry = load_registry()
    for p in registry["patients"]:
        if p["patientId"] == patient_id:
            return p
    return None


def proxy_to_container(patient_id, path, method="GET", data=None):
    """
    Proxy a request to a specific patient's ClawBox container.

    Container hostnames follow Docker Compose naming:
      clawbox-{patient_id}
    All containers expose port 18789 internally.
    """
    patient = get_patient(patient_id)
    if not patient:
        return {"error": "Patient not found"}, 404

    if patient.get("status") != "active":
        return {"error": "Patient container is not active"}, 503

    url = f"http://clawbox-{patient_id}:18789{path}"

    try:
        if method == "GET":
            resp = requests.get(url, timeout=10, params=request.args)
        elif method == "POST":
            resp = requests.post(url, json=data, timeout=10)
        else:
            return {"error": f"Unsupported method: {method}"}, 400

        return resp.json(), resp.status_code
    except requests.ConnectionError:
        return {"error": f"Cannot reach container for patient {patient_id}"}, 503
    except requests.Timeout:
        return {"error": "Container request timed out"}, 504
    except Exception as e:
        return {"error": str(e)}, 500


# --- Dashboard ---

@app.route("/api/dashboard")
def dashboard():
    """
    Aggregate dashboard: list all patients with quick status indicators.
    Calls each container's health endpoint to check if it's running.
    """
    registry = load_registry()
    patients = []

    for p in registry["patients"]:
        if p.get("status") != "active":
            continue

        status = {"patientId": p["patientId"], "name": f"{p['firstName']} {p['lastName']}",
                  "phone": p["phone"], "physicianName": p.get("physicianName", ""),
                  "containerStatus": "unknown", "unackedAlerts": 0}

        # Check container health
        try:
            resp = requests.get(
                f"http://clawbox-{p['patientId']}:18789/health", timeout=3
            )
            if resp.ok:
                status["containerStatus"] = "running"
                health = resp.json()
                status["uptime"] = health.get("uptime")
                status["memoryMB"] = health.get("memoryMB")
        except Exception:
            status["containerStatus"] = "offline"

        # Get unacknowledged alert count
        try:
            resp = requests.get(
                f"http://clawbox-{p['patientId']}:18789/api/patient/alerts", timeout=5
            )
            if resp.ok:
                alerts = resp.json()
                status["unackedAlerts"] = sum(
                    1 for a in alerts if not a.get("acknowledged")
                )
                # Find highest severity unacked alert
                unacked = [a for a in alerts if not a.get("acknowledged")]
                if unacked:
                    severities = {"emergency": 4, "urgent": 3, "warning": 2, "info": 1}
                    worst = max(unacked, key=lambda a: severities.get(a.get("severity", ""), 0))
                    status["worstAlert"] = worst.get("severity")
        except Exception:
            pass

        patients.append(status)

    return jsonify({
        "totalPatients": len(patients),
        "patientsOnline": sum(1 for p in patients if p["containerStatus"] == "running"),
        "totalAlerts": sum(p["unackedAlerts"] for p in patients),
        "patients": patients,
    })


# --- Patient List ---

@app.route("/api/patients")
def list_patients():
    registry = load_registry()
    return jsonify(registry["patients"])


# --- Patient Detail (proxied to container) ---

@app.route("/api/patients/<patient_id>")
def patient_detail(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/summary")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/alerts")
def patient_alerts(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/alerts")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/alerts/<int:alert_id>/acknowledge", methods=["POST"])
def acknowledge_alert(patient_id, alert_id):
    data = request.get_json(silent=True) or {}
    data["acknowledgedBy"] = data.get("acknowledgedBy", "physician")
    result, status = proxy_to_container(
        patient_id, f"/api/patient/alerts/{alert_id}/acknowledge", method="POST", data=data
    )
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/vitals")
def patient_vitals(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/vitals")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/medications")
def patient_medications(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/medications")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/adherence")
def patient_adherence(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/adherence")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/conversations")
def patient_conversations(patient_id):
    result, status = proxy_to_container(patient_id, "/api/patient/conversations")
    return jsonify(result), status


@app.route("/api/patients/<patient_id>/message", methods=["POST"])
def send_patient_message(patient_id):
    data = request.get_json(silent=True) or {}
    if not data.get("message"):
        return jsonify({"error": "Message body required"}), 400
    result, status = proxy_to_container(
        patient_id, "/api/patient/send-message", method="POST", data=data
    )
    return jsonify(result), status


# --- Health Check ---

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "doctor-portal"})


# --- Serve Frontend ---

@app.route("/")
def serve_frontend():
    return app.send_static_file("index.html")


@app.errorhandler(404)
def not_found(e):
    # If it's an API route, return JSON 404
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    # Otherwise try to serve the SPA
    return app.send_static_file("index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORTAL_PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_ENV") == "development")
