# EV Battery Health & Second-Life Predictor — Final Project

Everything needed to deploy this as a live, working website: an animated
React frontend and a Flask + ML backend (Random Forest/XGBoost for SOH,
LSTM for RUL forecasting — Phase 4).

## Important: why this needs TWO deployments, not one

**Netlify only hosts static frontends** (HTML/JS/CSS) — it cannot run a
Python/Flask server or a TensorFlow model. So this project deploys in two
parts:

1. **Frontend** (`/frontend`) → **Netlify** — the React app you interact with.
2. **Backend** (`/backend`) → a Python host like **Render** (free tier
   works) — runs Flask + your trained models.

The frontend calls the backend over the internet via `fetch()`. This is
completely standard practice (it's how nearly every real web app works) —
you're not doing anything unusual here.

**The frontend still works even if you skip the backend deployment** — it
has a built-in offline fallback using the same physics formula client-side,
so you can demo it immediately on Netlify alone and add the live backend
later. The "Backend: Live" / "Backend: Offline preview" badge in the header
shows which mode is active in real time.

---

## Step 1 — Deploy the backend (Render)

1. Push the `backend/` folder to a GitHub repo (or push the whole project
   and point Render at the `backend` subfolder).
2. Go to [render.com](https://render.com) → New → Web Service → connect
   your repo.
3. Settings:
   - **Root directory**: `backend`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `gunicorn app:app --timeout 120 --workers 1`
   - **Instance type**: Free tier is fine for a demo
4. Deploy. Copy the URL Render gives you, e.g.
   `https://ev-battery-api.onrender.com`
5. Test it works: open `https://<your-url>/health` in a browser — you
   should see `{"status": "ok", "soh_model_loaded": true, "rul_model_loaded": true}`.

**Note on free-tier cold starts**: Render's free tier sleeps after 15
minutes of inactivity and takes ~30-50 seconds to wake up on the next
request. If you're demoing live to judges, open the `/health` URL a minute
before your demo to "wake it up" — otherwise your first "Run Live
Diagnostic" click will look stuck. This is a real constraint worth
mentioning if asked, not a bug.

## Step 2 — Deploy the frontend (Netlify)

1. Push this whole project (or just `frontend/`) to GitHub.
2. Go to [netlify.com](https://netlify.com) → Add new site → Import from
   Git → select your repo.
3. Netlify should auto-detect the settings from `netlify.toml`:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `frontend/dist`
4. **Before deploying**, add an environment variable so the frontend knows
   where your backend lives:
   - Site settings → Environment variables → Add variable
   - Key: `VITE_API_URL`
   - Value: `https://ev-battery-api.onrender.com` (your Render URL from Step 1, no trailing slash)
5. Deploy. Netlify gives you a live URL like
   `https://your-project-name.netlify.app` — that's your working website.

**If you skip Step 1 entirely**: don't set `VITE_API_URL`, and the site
still works fully in offline-preview mode using the client-side formula.

## Local testing before you deploy

```bash
# Terminal 1 — backend
cd backend
pip install -r requirements.txt
python app.py
# runs on http://localhost:5000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# runs on http://localhost:5173, auto-connects to localhost:5000
```

---

## What's actually in this project

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite app — animated UI, calls the backend API, has offline fallback |
| `backend/app.py` | Flask API — SOH prediction (RandomForest/XGBoost) + RUL forecasting (LSTM) |
| `backend/soh_model_*.joblib` | Trained SOH models (Phase 2), validated on held-out NASA battery, R²=0.77 |
| `backend/rul_lstm_model.keras` | Phase 4 LSTM RUL forecaster, validated R²=0.668, MAE=8.9 cycles (vs. R²=0 for a naive baseline) |
| `backend/*_features.csv` | Processed NASA battery cycle data used for training/testing |

## API endpoints (backend)

- `GET /health` — status check
- `POST /predict/demo` — simplified consumer inputs (age, cycles, DoD%, C-rate, temp) → SOH, RUL, resale value
- `POST /predict/telemetry` — real BMS-style telemetry → trained model's SOH prediction
- `POST /predict/rul_forecast` — 8-cycle telemetry sequence → LSTM RUL forecast
- `GET /battery/sample/B0018?cycle=N` — pulls a real NASA test-battery cycle, for demoing `/predict/telemetry` with genuine data
- `GET /battery/sequence/B0018?cycle=N` — pulls 8 consecutive real cycles ending at N, for demoing `/predict/rul_forecast`

## Known limitations to mention if asked (this is a strength, not a weakness, if you say it yourself)

- The demo-mode SOH/RUL sliders run a physics-informed formula, not the
  trained model directly — the NASA lab data has no varying DoD/C-rate to
  train that mapping on. The trained model runs on real telemetry via
  `/predict/telemetry` and `/predict/rul_forecast` instead — see the "Test
  real ML model on NASA sample" button in the app for proof this isn't
  hand-waved.
- LSTM RUL forecasting (R²=0.668) is a genuine improvement over the
  Phase 3 snapshot-based approach, but is trained on lab data from a fixed
  protocol — real vehicle telemetry would need recalibration.
- Render's free tier cold-starts — see Step 1 note above.
