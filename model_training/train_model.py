import pandas as pd
import numpy as np
import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

FEATURES = [
    "cycle_number", "discharge_duration", "voltage_at_cutoff", "cell_temp_end",
    "charge_duration", "charge_peak_temp", "charge_mean_temp",
    "charge_mean_voltage", "charge_mean_current",
]
TARGET = "soh"

train = pd.read_csv("/home/claude/battery_project/work/train_features.csv")
test = pd.read_csv("/home/claude/battery_project/work/test_features.csv")

X_train, y_train = train[FEATURES], train[TARGET]
X_test, y_test = test[FEATURES], test[TARGET]

def evaluate(name, model):
    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    r2 = r2_score(y_test, preds)
    print(f"\n{name} — held-out battery B0018 (never seen in training)")
    print(f"  MAE  : {mae:.2f} SOH points")
    print(f"  RMSE : {rmse:.2f} SOH points")
    print(f"  R^2  : {r2:.3f}")
    return preds, {"mae": mae, "rmse": rmse, "r2": r2}

# --- Random Forest baseline -------------------------------------------------
rf = RandomForestRegressor(
    n_estimators=300, max_depth=8, min_samples_leaf=3, random_state=42
)
rf.fit(X_train, y_train)
rf_preds, rf_metrics = evaluate("Random Forest", rf)

# --- XGBoost -----------------------------------------------------------------
xgb = XGBRegressor(
    n_estimators=400, max_depth=4, learning_rate=0.05,
    subsample=0.9, colsample_bytree=0.9, random_state=42
)
xgb.fit(X_train, y_train)
xgb_preds, xgb_metrics = evaluate("XGBoost", xgb)

# --- Feature importance -------------------------------------------------------
importances = pd.Series(xgb.feature_importances_, index=FEATURES).sort_values(ascending=False)
print("\nXGBoost feature importance:")
print(importances.round(3))

# --- Save artifacts ------------------------------------------------------------
joblib.dump(rf, "/home/claude/battery_project/work/soh_model_rf.joblib")
joblib.dump(xgb, "/home/claude/battery_project/work/soh_model_xgb.joblib")

test_out = test.copy()
test_out["soh_pred_rf"] = rf_preds
test_out["soh_pred_xgb"] = xgb_preds
test_out.to_csv("/home/claude/battery_project/work/test_predictions.csv", index=False)

pd.DataFrame([
    {"model": "RandomForest", **rf_metrics},
    {"model": "XGBoost", **xgb_metrics},
]).to_csv("/home/claude/battery_project/work/metrics.csv", index=False)

importances.to_csv("/home/claude/battery_project/work/feature_importance.csv")

print("\nSaved: soh_model_rf.joblib, soh_model_xgb.joblib, test_predictions.csv, metrics.csv")
