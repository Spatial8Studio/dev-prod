# Spatia Studio

Spatia Studio is a React + Spring Boot web application for positioning audio
sources in a 3-D scene and rendering binaural MP3 output with the MATLAB
renderer from `backend/matlab/`.

## Structure

- `frontend/` - Vite React client with the 3-D placement workspace.
- `backend/` - Spring Boot REST API, local file storage, auth, and MATLAB
  integration.

## Run locally

### Backend

Requires Java 21+ and Maven.

```bash
cd backend
mvn spring-boot:run
```

The API starts on `http://localhost:8080`. Set `SPATIA_MATLAB_COMMAND` to the
MATLAB executable. Set `SPATIA_HRIR_FILE` to a measured HRIR dataset for
real front/back and elevation cues. Without it, the included synthetic fallback
uses approximate ITD, ILD, stronger vertical pinna/spectral cues, and rear-filtering cues. The
synthetic mode is designed to make front versus above/below audible during demos, but it is
still an approximation. Without MATLAB,
the app makes it explicit that the downloadable result is the original source
preview, not a spatial render.

If port 8080 is already used by another local service, start Spring Boot on a
different port and set `SPATIA_BACKEND_URL` before starting Vite, for example
`8081`.

### Frontend

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev
```

The client starts on `http://localhost:5173`.

For local testing, the backend seeds this demo account on every startup:

```text
Email: demo@gmail.com
Password: demo@123
```

Authentication sessions are held in memory, so log in again after restarting
the backend.

## MATLAB rendering

The original renderer is included at `backend/matlab/spatializeAudio.m`.
Production rendering requires MATLAB and FFmpeg. The backend writes each job's
input and output into `backend/storage/` and invokes a generated MATLAB script
with the submitted `[x y z]` coordinates.

Renders run in a single background worker. The frontend polls their status and
downloads the result only after completion. For research-quality output,
configure both `SPATIA_MATLAB_COMMAND` and `SPATIA_HRIR_FILE`; a measured HRIR
dataset has the direction-specific filtering that a synthetic fallback cannot
faithfully reproduce. The MATLAB loader accepts native CIPIC
`standard_hrir_database/subject_xxx/hrir_final.mat` files, including the
documented 25 x 50 direction grid and automatic 44.1 kHz-to-input-rate HRIR
resampling.

Example with CIPIC subject 003:

```powershell
$env:SPATIA_HRIR_FILE = "C:\path\to\subject_003\hrir_final.mat"
```

The included synthetic mode remains available when `SPATIA_HRIR_FILE` is
empty; it uses deliberately stronger vertical spectral and pinna cues for
demos. Measured HRIR renders also enable an intentionally obvious height cue
by default: a short 4--10 ms ceiling/pinna reflection plus a signed spectral
shelf. This makes above/below audibly different from front on ordinary
headphones, where natural elevation differences can be very subtle. To disable
that demo enhancement when comparing raw measured HRIRs, pass
`'ElevationCueStrength', 0` to `spatializeAudio`.

The backend console logs each upload, render request, generated MATLAB script,
MATLAB process exit code, and final output path. These logs are the quickest way
to verify that a render reached MATLAB rather than using the original-file
preview fallback.

## Product direction: projects, publishing, and discovery

The studio now supports two composition modes:

- `fixed` keeps each source at one `[x, y, z]` position. The backend sends the
  same start and destination coordinate, so MATLAB produces a stationary
  binaural source.
- `animated` stores a start coordinate, destination coordinate, and travel time.
  The React timeline previews the path and MATLAB renders the source moving
  through it.

Projects are currently held in memory by the Spring Boot prototype. A project
stores its title, description, mode, scene coordinates, source names, and an
optional completed render. Published projects appear in Community and their
completed render can be downloaded through the public project-audio endpoint.
The next persistence step is PostgreSQL for project metadata and S3-compatible
object storage for source/render files.

## ML recommendation roadmap

Recommendations should be added as a separate service after the core project
workflow is stable. The proposed pipeline is:

1. **Event capture** — record privacy-aware events such as project opened,
   render completed, source count, coordinate trajectories, mode, tags, and
   explicit likes/follows. Do not upload raw audio for recommendations by
   default.
2. **Audio descriptors** — extract optional offline descriptors from user-owned
   files: loudness, tempo, spectral centroid, spectral contrast, MFCC statistics,
   duration, channel layout, and a compact audio embedding. Store descriptors,
   not the original audio, in an `audio_features` table or feature store.
3. **Project embeddings** — combine audio descriptors with spatial descriptors
   such as source count, azimuth/elevation distribution, trajectory length,
   speed, and fixed/animated mode. Normalize each feature family separately and
   version the feature schema.
4. **Candidate generation** — start with content-based nearest neighbors using
   cosine similarity. Add collaborative signals from follows, saves, and
   completed listens only after enough interaction data exists.
5. **Ranking** — rank candidates with a small learning-to-rank model using
   similarity, creator diversity, freshness, and an exploration term. Keep a
   deterministic cold-start path based on tags and content descriptors.
6. **Serving** — expose `GET /api/recommendations?projectId=...` from a Python
   or Java service. Cache short-lived results, return explanation fields such
   as `similar spatial motion` or `similar spectral texture`, and never block
   MATLAB rendering on recommendation availability.

Suggested later stack: Python FastAPI, librosa/torchaudio for descriptors,
FAISS or pgvector for nearest-neighbor search, PostgreSQL for metadata, and an
offline job runner for feature extraction. Evaluate with Recall@K, NDCG@K,
coverage, creator diversity, and a human listening study. Keep recommendation
data opt-in, provide a delete/export path, and separate private projects from
public discovery data.
