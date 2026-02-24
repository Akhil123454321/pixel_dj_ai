# AI DJ

AI DJ is a full-stack app that generates Spotify-ready DJ sets from a vibe prompt and seed tracks, then learns from user feedback to improve future rankings.

## Stack

- Frontend: Next.js 16, React 19, TypeScript, NextAuth (Spotify OAuth)
- Backend: FastAPI, aiosqlite, Pydantic
- Optional ML/audio: librosa, scikit-learn, xgboost
- Data store: SQLite (`backend/feedback.db`)

## Features

- Spotify login with token refresh
- Prompt + seed-based set generation (`/api/generate-set`)
- Transition timeline and DJ reasoning UI
- Spotify playback transfer/control for Premium users
- Feedback capture for implicit preference learning
- ML training/status endpoints
- Optional uploaded audio analysis (BPM/key/energy/danceability/valence)

## Repository Layout

```text
.
├── frontend/        # Next.js app (UI + auth + Spotify Web Playback usage)
├── backend/         # FastAPI app (set generation, feedback, ML, analysis)
├── ml/              # local ML-related artifacts/scripts (if used)
└── render.yaml      # Render deployment config for backend
```

## Prerequisites

- Node.js 20+
- Python 3.12+
- Spotify Developer app credentials

## Environment Variables

### Frontend (`frontend/.env.local`)

Copy from `frontend/.env.example`:

```bash
cp frontend/.env.example frontend/.env.local
```

Required values:

- `NEXTAUTH_URL` (usually `http://localhost:3000`)
- `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`)
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `NEXT_PUBLIC_API_URL` (usually `http://localhost:8000`)

### Backend (`backend/.env`)

Create `backend/.env` with:

```env
DATABASE_URL=sqlite:///./feedback.db
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=
SPOTIFY_API_BASE=https://api.spotify.com/v1
ML_MODEL_DIR=ml_models
ML_MIN_TRAINING_SAMPLES=30
```

## Local Development

### 1. Start backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Optional ML/audio extras:

```bash
pip install -r requirements-ml.txt
```

Health check:

- `GET http://localhost:8000/health`

### 2. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## API Overview

All main endpoints are prefixed with `/api`.

- `POST /api/generate-set` - Build a DJ set from prompt/seeds (requires Spotify bearer token)
- `GET /api/track-features/{track_id}` - Fetch estimated track features
- `POST /api/feedback` - Record interaction feedback and process training pairs
- `POST /api/analyze-audio` - Upload audio file and cache extracted features
- `POST /api/ml/train` - Trigger model training manually
- `GET /api/ml/status` - Inspect training data and latest model metadata

## Deployment

Backend deployment config is included via [`render.yaml`](/Users/akhilsk123/Desktop/my_projects/ai_dj/render.yaml).

Expected production flow:

- Deploy backend to Render
- Deploy frontend (for example, Vercel)
- Set backend `FRONTEND_URL` and `CORS_ORIGINS` to your frontend domain
- Set frontend `NEXT_PUBLIC_API_URL` to backend public URL

## Notes

- In-browser playback requires a Spotify Premium account. Free accounts can still generate sets and use planning views.
- SQLite and local model artifacts are git-ignored.
- Do not commit secrets from `.env.local` or `.env`.
