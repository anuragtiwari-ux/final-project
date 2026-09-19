"""
EV Battery Health & Second-Life Prediction — Flask API
--------------------------------------------------------
Two prediction modes, because the trained ML model and the consumer-facing
demo UI currently speak different "languages":

1. /predict/telemetry
   Takes the EXACT feature set the model was trained on (real BMS-style
   signals: charge current/voltage, discharge duration, cell temperature,
   cycle number). This is the "real" model — genuinely trained on NASA
   battery data, validated on an unseen battery (R^2 ~ 0.77).

2. /predict/demo
   Takes the simplified, buyer-friendly fields the React prototype's
   sliders collect (age, cycle count, avg DoD%, C-rate, avg temperature).
   The NASA dataset was recorded under a fixed lab protocol (no varying
   DoD/C-rate), so the trained model can't consume these directly — this
   endpoint uses the same physics-informed degradation formula as Phase 1,
   just now served from the backend instead of computed client-side. Swap
   this for a calibrated translation layer once you have access to
   real multi-condition battery data (see README "Known limitation").

Run:
    pip install -r requirements.txt
    python app.py
Server starts on http://localhost:5000
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import os

app = Flask(__name__)
CORS(app)  # allow the React frontend (different origin) to call this API

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
model = joblib.load(os.path.join(MODEL_DIR, "soh_model_rf.joblib"))

# LSTM RUL forecaster (Phase 4) — loaded lazily/guarded so the SOH endpoints
# keep working even in an environment where TensorFlow isn't installed.
RUL_WINDOW = 8
RUL_FEATURES = [
    "cycle_number", "discharge_duration", "voltage_at_cutoff", "cell_temp_end",
    "charge_duration", "charge_peak_temp", "charge_mean_temp",
    "charge_mean_voltage", "charge_mean_current", "soh",
]
try:
    from tensorflow import keras
    rul_model = keras.models.load_model(os.path.join(MODEL_DIR, "rul_lstm_model.keras"))
    rul_scaler = joblib.load(os.path.join(MODEL_DIR, "rul_scaler.joblib"))
except Exception as e:  # pragma: no cover
    rul_model, rul_scaler = None, None
    print("RUL LSTM model not loaded:", e)

TELEMETRY_FEATURES = [
    "cycle_number", "discharge_duration", "voltage_at_cutoff", "cell_temp_end",
    "charge_duration", "charge_peak_temp", "charge_mean_temp",
    "charge_mean_voltage", "charge_mean_current",
]

SOH_THRESHOLD = 80.0  # second-life / resale-eligibility cutoff, industry standard


def classify(soh):
    if soh >= 90:
        return {"label": "Excellent", "sub": "Prime resale grade"}
    if soh >= 80:
        return {"label": "Good", "sub": "Resale eligible"}
    if soh >= 70:
        return {"label": "Fair", "sub": "Second-life candidate - solar storage"}
    return {"label": "Poor", "sub": "Below reuse threshold - recycle"}


def resale_estimate(soh, capacity_kwh, cost_per_kwh):
    original_value = capacity_kwh * cost_per_kwh
    resale_value = original_value * (0.35 + (soh / 100) * 0.55)
    return round(original_value), round(resale_value)


# ---------------------------------------------------------------------------
# 1. REAL MODEL — exact trained feature set (BMS telemetry style)
# ---------------------------------------------------------------------------
@app.route("/predict/telemetry", methods=["POST"])
def predict_telemetry():
    data = request.get_json(force=True)
    missing = [f for f in TELEMETRY_FEATURES if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    x = np.array([[data[f] for f in TELEMETRY_FEATURES]])
    soh = float(model.predict(x)[0])
    soh = max(30.0, min(100.0, soh))

    # RUL: project forward by incrementing cycle_number only, holding the
    # rest of the telemetry constant (approximation — assumes charging
    # behaviour stays similar). Good enough for a directional estimate.
    rul_cycles = 0
    if soh > SOH_THRESHOLD:
        probe = dict(data)
        step = 20
        guard = 0
        while soh > SOH_THRESHOLD and guard < 300:
            probe["cycle_number"] += step
            x_probe = np.array([[probe[f] for f in TELEMETRY_FEATURES]])
            soh = float(model.predict(x_probe)[0])
            guard += 1
        rul_cycles = guard * step

    soh_now = float(model.predict(x)[0])
    soh_now = max(30.0, min(100.0, soh_now))
    status = classify(soh_now)

    return jsonify({
        "mode": "telemetry",
        "model": "RandomForest (trained on NASA B0005/B0006/B0007, validated on B0018)",
        "soh": round(soh_now, 1),
        "rul_cycles_to_80pct": rul_cycles,
        "classification": status,
    })


# ---------------------------------------------------------------------------
# 2. DEMO MODE — simplified consumer-facing fields (Phase 1 formula, served
#    via the backend so the frontend architecture is ready for a real model
#    swap later without changing how the UI calls the API).
# ---------------------------------------------------------------------------
def compute_soh_formula(age_months, cycles, avg_dod, c_rate, avg_temp, cycle_override=None):
    c = cycle_override if cycle_override is not None else cycles
    temp_stress = np.exp((avg_temp - 25) / 18)
    dod_stress = 1 + (avg_dod / 100 - 0.5) * 0.7
    crate_stress = 1 + max(0, c_rate - 1) * 0.18

    cycle_fade = 2.1 * np.sqrt(c) * temp_stress * dod_stress * crate_stress * 0.01
    calendar_fade = 0.09 * age_months * temp_stress * 0.6

    soh = 100 - cycle_fade - calendar_fade
    return max(30.0, min(100.0, soh))


@app.route("/predict/demo", methods=["POST"])
def predict_demo():
    data = request.get_json(force=True)
    required = ["ageMonths", "cycles", "avgDoD", "cRate", "avgTemp", "capacityKwh", "originalCostPerKwh"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"error": f"Missing fields: {missing}"}), 400

    age_months = data["ageMonths"]
    cycles = data["cycles"]
    avg_dod = data["avgDoD"]
    c_rate = data["cRate"]
    avg_temp = data["avgTemp"]

    soh = compute_soh_formula(age_months, cycles, avg_dod, c_rate, avg_temp)

    rul_cycles = 0
    if soh > SOH_THRESHOLD:
        c = cycles
        step = 50
        guard = 0
        probe_soh = soh
        while probe_soh > SOH_THRESHOLD and guard < 400:
            c += step
            probe_soh = compute_soh_formula(age_months, cycles, avg_dod, c_rate, avg_temp, cycle_override=c)
            guard += 1
        rul_cycles = c - cycles

    original_value, resale_value = resale_estimate(soh, data["capacityKwh"], data["originalCostPerKwh"])
    status = classify(soh)
    second_life = soh < 80 and soh >= 55

    return jsonify({
        "mode": "demo",
        "model": "physics-informed formula (Phase 1) — served via API",
        "soh": round(soh, 1),
        "rul_cycles_to_80pct": rul_cycles,
        "classification": status,
        "original_value_inr": original_value,
        "resale_value_inr": resale_value,
        "second_life_eligible": bool(second_life),
    })


# ---------------------------------------------------------------------------
# 3. PHASE 4 — LSTM RUL FORECAST
#    Takes the last RUL_WINDOW (8) cycles of telemetry + that cycle's SOH,
#    and forecasts Remaining Useful Life from the *trajectory*, not a single
#    snapshot. Validated on held-out B0018: MAE 3.7 cycles, R^2 = 0.940
#    (vs. R^2 = 0.0 for a naive "always predict the average" baseline).
# ---------------------------------------------------------------------------
@app.route("/predict/rul_forecast", methods=["POST"])
def predict_rul_forecast():
    if rul_model is None:
        return jsonify({"error": "RUL forecasting model not available on this server"}), 503

    data = request.get_json(force=True)
    sequence = data.get("sequence")
    if not sequence or len(sequence) != RUL_WINDOW:
        return jsonify({"error": f"'sequence' must contain exactly {RUL_WINDOW} cycles, oldest first"}), 400

    missing_fields = [f for f in RUL_FEATURES if f not in sequence[0]]
    if missing_fields:
        return jsonify({"error": f"Each cycle needs fields: {RUL_FEATURES}"}), 400

    x_raw = np.array([[c[f] for f in RUL_FEATURES] for c in sequence])
    x_scaled = rul_scaler.transform(x_raw)
    x_input = x_scaled.reshape(1, RUL_WINDOW, len(RUL_FEATURES))

    rul_pred = float(rul_model.predict(x_input, verbose=0)[0][0])
    rul_pred = max(0.0, rul_pred)

    return jsonify({
        "mode": "rul_forecast",
        "model": "LSTM (trained on NASA cycle trajectories, validated on B0018: R^2=0.940, MAE=3.7 cycles)",
        "rul_cycles_to_80pct": round(rul_pred, 1),
        "window_size_used": RUL_WINDOW,
    })


# ---------------------------------------------------------------------------
@app.route("/battery/sample/<battery_id>", methods=["GET"])
def sample(battery_id):
    """Returns a real cycle from the held-out test battery, so you can hit
    /predict/telemetry with genuine NASA data during a live demo instead of
    typing numbers by hand."""
    import pandas as pd
    df = pd.read_csv(os.path.join(MODEL_DIR, "test_features.csv"))
    if battery_id.upper() != "B0018":
        return jsonify({"error": "Only B0018 sample data is bundled with this API"}), 404
    cycle = request.args.get("cycle", default=50, type=int)
    row = df.iloc[(df["cycle_number"] - cycle).abs().argsort()[:1]]
    return jsonify(row[TELEMETRY_FEATURES + ["soh"]].to_dict(orient="records")[0])


@app.route("/battery/sequence/<battery_id>", methods=["GET"])
def sequence(battery_id):
    """Returns RUL_WINDOW consecutive real cycles ending at ?cycle=, for
    testing /predict/rul_forecast with genuine trajectories instead of
    hand-typed sequences."""
    import pandas as pd
    df = pd.read_csv(os.path.join(MODEL_DIR, "test_features.csv")).sort_values("cycle_number")
    if battery_id.upper() != "B0018":
        return jsonify({"error": "Only B0018 sample data is bundled with this API"}), 404
    end_cycle = request.args.get("cycle", default=60, type=int)
    window = df[df["cycle_number"] <= end_cycle].tail(RUL_WINDOW)
    if len(window) < RUL_WINDOW:
        return jsonify({"error": f"Not enough history before cycle {end_cycle}; need {RUL_WINDOW} prior cycles"}), 400
    return jsonify({"sequence": window[RUL_FEATURES].to_dict(orient="records")})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "soh_model_loaded": model is not None,
        "rul_model_loaded": rul_model is not None,
    })


if __name__ == "__main__":
    app.run(debug=False, port=5000)
