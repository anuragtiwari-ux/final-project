"""
Phase 4a — LSTM Remaining Useful Life (RUL) forecasting.

Why this exists: the Phase 2 Random Forest/XGBoost model predicts SOH from a
SINGLE cycle's snapshot. It has no sense of trajectory, so projecting it
forward to estimate RUL barely moves (see Phase 3 README's "Known
limitation"). An LSTM instead reads a WINDOW of past cycles and learns how
the trend itself evolves, which is what RUL forecasting actually needs.

Approach:
  1. For every cycle, compute ground-truth RUL = number of cycles until this
     battery's measured capacity crosses the 80% SOH threshold (censored at
     the battery's last recorded cycle if it never crosses).
  2. Build sliding windows of WINDOW_SIZE consecutive cycles' features.
  3. Train an LSTM to map a window -> RUL at the window's last cycle.
  4. Validate on B0018, held out completely (same discipline as Phase 2).
"""
import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow import keras
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

WINDOW_SIZE = 8
SOH_THRESHOLD = 80.0
FEATURES = [
    "cycle_number", "discharge_duration", "voltage_at_cutoff", "cell_temp_end",
    "charge_duration", "charge_peak_temp", "charge_mean_temp",
    "charge_mean_voltage", "charge_mean_current", "soh",
]

train = pd.read_csv("/home/claude/battery_project/work/train_features.csv")
test = pd.read_csv("/home/claude/battery_project/work/test_features.csv")


def compute_rul_labels(df):
    """RUL at cycle i = cycles remaining until SOH first drops below 80%.
    If the battery never drops below 80% in the recorded data, RUL is
    censored at (last cycle - i) -- a conservative, honest floor rather than
    a guess beyond the data we actually have."""
    df = df.sort_values("cycle_number").reset_index(drop=True)
    soh = df["soh"].values
    n = len(soh)
    below = np.where(soh < SOH_THRESHOLD)[0]
    first_below = below[0] if len(below) else None
    rul = np.zeros(n)
    for i in range(n):
        if first_below is not None and first_below > i:
            rul[i] = first_below - i
        elif first_below is not None and first_below <= i:
            rul[i] = 0
        else:
            rul[i] = (n - 1) - i  # censored: never crosses threshold in-data
    df["rul"] = rul
    return df


def build_windows(df, scaler=None, fit_scaler=False):
    df = compute_rul_labels(df)
    X_raw = df[FEATURES].values.astype(float)
    if fit_scaler:
        scaler = StandardScaler().fit(X_raw)
    X_scaled = scaler.transform(X_raw)

    X, y = [], []
    for i in range(WINDOW_SIZE - 1, len(df)):
        X.append(X_scaled[i - WINDOW_SIZE + 1 : i + 1])
        y.append(df["rul"].iloc[i])
    return np.array(X), np.array(y), scaler


# Build training windows per-battery (never window across a battery boundary)
X_train_parts, y_train_parts = [], []
scaler = None
for bat, grp in train.groupby("battery_id"):
    Xb, yb, scaler = build_windows(grp, scaler=scaler, fit_scaler=(scaler is None))
    X_train_parts.append(Xb)
    y_train_parts.append(yb)
X_train = np.concatenate(X_train_parts)
y_train = np.concatenate(y_train_parts)

X_test, y_test, _ = build_windows(test, scaler=scaler, fit_scaler=False)

print("Train windows:", X_train.shape, "Test windows:", X_test.shape)

# --- LSTM model --------------------------------------------------------------
tf.random.set_seed(42)
model = keras.Sequential([
    keras.layers.Input(shape=(WINDOW_SIZE, len(FEATURES))),
    keras.layers.LSTM(32, return_sequences=True),
    keras.layers.LSTM(16),
    keras.layers.Dense(16, activation="relu"),
    keras.layers.Dense(1),
])
model.compile(optimizer=keras.optimizers.Adam(0.005), loss="mae")

es = keras.callbacks.EarlyStopping(patience=15, restore_best_weights=True)
history = model.fit(
    X_train, y_train,
    validation_data=(X_test, y_test),
    epochs=150, batch_size=16, verbose=0, callbacks=[es],
)

preds = model.predict(X_test, verbose=0).flatten()
preds = np.clip(preds, 0, None)

mae = mean_absolute_error(y_test, preds)
r2 = r2_score(y_test, preds)
print(f"\nLSTM RUL forecast — held-out battery B0018")
print(f"  MAE : {mae:.1f} cycles")
print(f"  R^2 : {r2:.3f}")
print(f"  Epochs trained: {len(history.history['loss'])}")

# Save model + scaler for the API
model.save("/home/claude/battery_project/work/rul_lstm_model.keras")
joblib.dump(scaler, "/home/claude/battery_project/work/rul_scaler.joblib")

pd.DataFrame({
    "cycle_number": test["cycle_number"].iloc[WINDOW_SIZE - 1:].values,
    "true_rul": y_test,
    "pred_rul": preds,
}).to_csv("/home/claude/battery_project/work/rul_test_predictions.csv", index=False)

with open("/home/claude/battery_project/work/rul_metrics.txt", "w") as f:
    f.write(f"MAE: {mae:.2f} cycles\nR2: {r2:.3f}\nWindow size: {WINDOW_SIZE}\n")

print("\nSaved: rul_lstm_model.keras, rul_scaler.joblib, rul_test_predictions.csv")
