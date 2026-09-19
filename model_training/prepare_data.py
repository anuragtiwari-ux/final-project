import pandas as pd
import numpy as np

RAW = "/home/claude/battery_project/RUL_prediction/data/NASA"

def load_discharge(battery, split):
    df = pd.read_csv(f"{RAW}/discharge/{split}/{battery}_discharge.csv")
    df = df.sort_values("cycle").reset_index(drop=True)
    return df

def load_charge_summary(battery, split):
    df = pd.read_csv(f"{RAW}/charge/{split}/{battery}_charge.csv")
    # Charge file has many rows per cycle (raw time series during charging).
    # Aggregate to one row per cycle: duration, peak temp, mean current, mean voltage.
    agg = df.groupby("cycle").agg(
        charge_duration=("time", "max"),
        charge_peak_temp=("temp_battery", "max"),
        charge_mean_temp=("temp_battery", "mean"),
        charge_mean_voltage=("voltage_battery", "mean"),
        charge_mean_current=("current_battery", "mean"),
    ).reset_index()
    return agg

def build_battery_features(battery, split):
    dis = load_discharge(battery, split).sort_values("cycle").reset_index(drop=True)
    chg = load_charge_summary(battery, split).sort_values("cycle").reset_index(drop=True)

    # NASA's raw step numbering interleaves charge/discharge/impedance steps
    # (discharge ids are odd, charge ids are even, e.g. charge=0,2,4... then
    # discharge=1,3,5...), so they don't share a common "cycle" key. Pair
    # them chronologically instead: the i-th charge step precedes the i-th
    # discharge step in real time, i.e. one full charge-discharge cycle.
    n = min(len(dis), len(chg))
    dis = dis.iloc[:n].reset_index(drop=True)
    chg = chg.iloc[:n].reset_index(drop=True).drop(columns=["cycle"])
    df = pd.concat([dis, chg], axis=1)

    # True sequential cycle count (1, 2, 3, ...) — this is what maps to the
    # "Total charge cycles" field a user enters in the app.
    df["cycle_number"] = np.arange(1, n + 1)
    df["battery_id"] = battery

    # SOH relative to this cell's own first recorded (as-new) capacity —
    # standard practice since manufacturing tolerance means B0005/6/7/18
    # don't all start at exactly the same capacity.
    rated_capacity = df["capacity"].iloc[0]
    df["rated_capacity"] = rated_capacity
    df["soh"] = (df["capacity"] / rated_capacity) * 100.0

    # Discharge "fingerprint" features — these are the things that actually
    # shift as a cell ages, standing in for cycles/DoD/C-rate/temp stress in
    # the deployed system once real BMS logs are available.
    df["discharge_duration"] = df["time"]  # seconds to hit cutoff voltage
    df["voltage_at_cutoff"] = df["voltage_battery"]
    df["cell_temp_end"] = df["temp_battery"]

    # Fill any missing charge-side aggregates (a few cycles may lack a
    # matching charge log) with column median so training doesn't break.
    for col in ["charge_duration", "charge_peak_temp", "charge_mean_temp",
                "charge_mean_voltage", "charge_mean_current"]:
        df[col] = df[col].fillna(df[col].median())

    feature_cols = [
        "cycle_number", "amb_temp", "discharge_duration", "voltage_at_cutoff",
        "cell_temp_end", "charge_duration", "charge_peak_temp",
        "charge_mean_temp", "charge_mean_voltage", "charge_mean_current",
    ]
    return df[["battery_id", "capacity", "rated_capacity", "soh"] + feature_cols]

if __name__ == "__main__":
    train = pd.concat([
        build_battery_features("B0005", "train"),
        build_battery_features("B0006", "train"),
        build_battery_features("B0007", "train"),
    ], ignore_index=True)
    test = build_battery_features("B0018", "test")

    train.to_csv("/home/claude/battery_project/work/train_features.csv", index=False)
    test.to_csv("/home/claude/battery_project/work/test_features.csv", index=False)

    print("TRAIN shape:", train.shape, "batteries:", train.battery_id.unique())
    print("TEST shape:", test.shape, "batteries:", test.battery_id.unique())
    print(train.describe().T[["mean","std","min","max"]])
