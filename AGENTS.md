# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repository shape
- Monorepo with:
  - `backend/`: FastAPI service + ML orchestration/prediction stack.
  - `frontend/fin-intel/`: Next.js app (App Router) that calls backend APIs.
- Root `README.md` is ML-focused; active runtime app surfaces are in `backend/main.py` and `frontend/fin-intel/`.

## Core development commands

### Backend (from repository root)
- Install dependencies:
  - `python3 -m pip install -r requirements.txt`
- Run API server:
  - `uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- Quick API smoke checks:
  - `curl http://127.0.0.1:8000/ping`
  - `curl http://127.0.0.1:8000/market`
  - `curl http://127.0.0.1:8000/stock/AAPL`

### Frontend (from `frontend/fin-intel`)
- Install dependencies:
  - `npm install`
- Run local dev server:
  - `npm run dev`
- Lint:
  - `npm run lint`
- Production build / serve:
  - `npm run build`
  - `npm run start`

### Tests
- No automated test suite is currently configured in this fork (no test files found and no `test` script in `frontend/fin-intel/package.json`).

## Environment and integration notes
- Backend expects `NEWS_API_KEY` (see `config.py`) for NewsAPI integration; without it, news aggregation falls back to non-NewsAPI sources only.
- Frontend backend base URL comes from `NEXT_PUBLIC_API_URL` (defaults to `http://127.0.0.1:8000`) in `frontend/fin-intel/utils/fetcher.ts`.
- Frontend Firebase auth/firestore setup requires `NEXT_PUBLIC_FIREBASE_*` variables (`frontend/fin-intel/lib/firebase.ts`).

## High-level architecture

### Backend request flow
- `backend/main.py` exposes FastAPI routes for:
  - market snapshot (`/market`)
  - stock analysis (`/stock/{ticker}`)
  - news (`/news/{ticker}`, `/news/market`)
  - pattern analysis (`/pattern-analysis`, `/pattern-analysis/{ticker}`)
  - portfolio and cache management.
- `/stock/{ticker}` concurrently executes:
  - full orchestration pipeline (`run_complete_pipeline`)
  - ticker metadata + price history fetch
  - standalone pattern analysis
  - standalone prediction
  then merges into one response payload for the frontend.
- In-process TTL caching is implemented in `backend/main.py` (market/news/stock/search caches with separate TTLs).

### Backend analysis pipeline layers
- `backend/orchestration/complete_pipeline.py` is the fusion core:
  - runs technical, sentiment, and fundamental stages in parallel;
  - optionally augments with pattern + prediction summaries;
  - fuses signals into final score + BUY/HOLD/SELL decision.
- Technical branch:
  - primary path uses GRU model + engineered features (`backend/preprocessing/stock_feature_scraper.py` and technical model assets);
  - fallback path uses MA/RSI heuristics when model/dependencies/features are unavailable.
- Sentiment branch:
  - news pulled from multi-source scraper (`backend/scraper/news_scraper.py`);
  - scored with local FinBERT when model assets exist, otherwise fallback sentiment logic (`backend/preprocessing/sentiment_model_scoring.py`).
- Fundamental branch:
  - financial scrape + aggregation model in `backend/scraper/fundamental_financial_scraper.py` and `backend/aggregation/fundamentalFunctions/fundamental_models.py`.
- Service wrappers in `backend/services/` (`decision_service.py`, `prediction_service.py`, `pattern_service.py`) provide cached, reusable outputs for API routes and fusion logic.

### Frontend architecture
- Next.js App Router app under `frontend/fin-intel/app/` with dashboard-centric UI.
- Global providers (`frontend/fin-intel/app/providers.tsx`) configure:
  - React Query (`staleTime: 5 min`, no refetch-on-focus),
  - theme provider.
- Data fetching usually goes through backend endpoints via `API_BASE` in `frontend/fin-intel/utils/fetcher.ts`.
- `frontend/fin-intel/app/api/market/route.ts` is a local mocked market endpoint; backend `/market` is the real integrated market-data path.

## Existing nested agent guidance to keep
- `frontend/fin-intel/AGENTS.md` currently contains a critical Next.js rule: treat this Next.js version as potentially breaking from prior assumptions and check local framework docs before coding against conventions/APIs.
- `frontend/fin-intel/CLAUDE.md` points directly to that AGENTS guidance; preserve this linkage if those files are edited.
