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
MATLAB executable (or leave it unset to use the built-in development fallback
that copies the input file as a stereo-compatible preview).

### Frontend

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev
```

The client starts on `http://localhost:5173`.

## MATLAB rendering

The original renderer is included at `backend/matlab/spatializeAudio.m`.
Production rendering requires MATLAB and FFmpeg. The backend writes each job's
input and output into `backend/storage/` and invokes a generated MATLAB script
with the submitted `[x y z]` coordinates.

The development fallback is intentionally explicit and is not a spatial
renderer; configure `SPATIA_MATLAB_COMMAND` for real binaural output.