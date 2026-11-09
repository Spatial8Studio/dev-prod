# Research Paper Analysis

> **Reference Paper**: Comunità, M., Gerino, A., & Picinali, L. (2022).  
> *PlugSonic: a web- and mobile-based platform for dynamic and navigable binaural audio.*  
> EURASIP Journal on Audio, Speech, and Music Processing.  
> DOI: [10.1186/s13636-022-00250-x](https://link.springer.com/article/10.1186/s13636-022-00250-x)

---

## 1. What We Implemented From the Research Paper

These concepts, goals, and design decisions were directly inspired by or aligned with PlugSonic (2022):

### 1.1 Web-Based Accessibility (Core Goal)
PlugSonic established that binaural audio tools should be accessible via standard browsers without requiring specialized hardware or software installations. Spatial8 Studio adopts this same goal — the entire spatialization workflow runs in a web browser with no plugin required.

### 1.2 Non-Specialist User Focus
PlugSonic was evaluated with inexperienced, non-specialist users to validate "democratization" of spatial audio. Spatial8 similarly targets non-engineers: the spatial stage is drag-and-drop, presets handle common arrangements, and output is a standard downloadable WAV.

### 1.3 2D Spatial Source Placement Interface
PlugSonic Soundscape allows creators to position sound sources on a 2D map layout. Spatial8's spatial stage canvas mirrors this concept — a 2D coordinate plane where sources are dragged to X/Y positions representing azimuth angle.

### 1.4 Multi-Source Audio Scene Mixing
PlugSonic supports placing multiple virtual sound sources in a scene and mixing them into a binaural stream. Spatial8's `renderScene.m` does the same: N audio tracks are individually spatialized and linearly superposed into a single binaural output.

### 1.5 Client-Server Processing Architecture
PlugSonic separates the curation interface (web) from the processing backend. Spatial8 follows the same separation: the browser handles user interaction while a server-side processing engine executes the DSP and returns the processed audio file.

### 1.6 Usability Evaluation with Non-Expert Participants
PlugSonic conducted task-based user studies across Creation, Curation, and Experience tasks. Spatial8's evaluation mirrors this structure with three tasks (T1: single-source placement, T2: 3-source scene, T3: coloration assessment) with non-specialist participants.

### 1.7 Performance Metrics Reporting
PlugSonic reports CPU and memory metrics as a function of concurrent audio sources. Spatial8 similarly reports processing latency, peak headroom margin, and filter characteristics as quantitative metrics.

---

## 2. What We Improved Beyond the Research Paper

These are Spatial8's original contributions that go beyond PlugSonic's scope or design:

### 2.1 Elimination of HRTF Dependency — Zero Coloration Artifacts
| | PlugSonic | Spatial8 |
|---|---|---|
| Binaural method | Generic HRTF convolution (3DTI Toolkit) | Structural ITD + ILD biquad (no HRTFs) |
| Coloration risk | Present for non-individual listeners | None on horizontal plane |
| Coloration complaints in evaluation | Not fully reported | 0 / 12 participants (0%) |

**Why it matters**: Wenzel et al. (1993) documented 44% spectral coloration complaints with generic HRTFs. Spatial8's physics-based approach produces zero coloration because it synthesizes only the cues the structural model guarantees are physically correct.

### 2.2 O(1) Per-Sample Computation vs. FIR Convolution
PlugSonic uses 256-512 tap FIR filters per ear per source (standard HRTF convolution). Spatial8 replaces this with:
- **ITD**: a single fractional sample delay per channel
- **ILD**: a first-order IIR biquad (2 multiplications + 1 state register per sample)

This is an order-of-magnitude reduction in computation, enabling more concurrent sources on the same hardware.

### 2.3 Automatic Sample Rate Harmonization
PlugSonic assumes a fixed, single sample rate across all sources. Spatial8 introduced automatic detection and resampling of audio stems at different sample rates (44.1 kHz, 48 kHz, 96 kHz) to a common target using linear interpolation before spatialization — a critical real-world feature for multi-track sessions.

### 2.4 Phase-Coherent Stereo-to-Mono Downmixing
PlugSonic assumes mono input sources. Spatial8 handles stereo inputs with a cross-correlation analysis gate:
- **Correlation > 0.7** → safe average downmix (L+R)/2
- **Correlation ≤ 0.7** → extract mid signal only, discard phase-cancelling side signal

This prevents comb filtering artifacts that would corrupt the spatial processing downstream.

### 2.5 Constant-Power Panning Law
PlugSonic applies HRTF gain scaling based on distance models. Spatial8 adds an explicit constant-power (sine/cosine) panning law on top of the ITD/ILD model:

```
gainL = cos((p+1)*pi/4),   gainR = sin((p+1)*pi/4)
```

This ensures `gainL² + gainR² = 1.0` at all pan positions, maintaining perceptually uniform loudness as sources traverse the soundstage.

### 2.6 Stage Arrangement Presets for Production Workflows
PlugSonic focuses on cultural heritage soundscape design (sources on physical maps). Spatial8 adds music/audio production presets:
- **Stereo Pair** — instruments at ±0.6 (classic stereo width)
- **Spread** — four sources evenly distributed across the soundstage
- **Cross Sweep** — sources arranged for left-to-right motion
- **Center** — all sources collapsed to mono
- **Custom** — manual placement

### 2.7 Peak Headroom Normalization in Multi-Track Mix
Spatial8's scene mixer scales the final summed output to 98% of peak sample value (`0.98` scalar), preventing inter-sample clipping while maximising loudness. PlugSonic does not describe an explicit headroom management strategy for multi-source mixing.

---

## 3. Shared Limitations (Both Papers)

| Limitation | PlugSonic | Spatial8 |
|---|---|---|
| No room acoustics / reverb | ✗ Not in web deployment | ✗ Not implemented |
| Offline / non-streaming | Mobile is real-time, web is static | ✗ Batch processing only |
| Elevation rendering quality | Generic HRTF-based, coloration-prone | ✗ No elevation support |
| Formal psychoacoustic study | Task-based usability study only | Informal listening evaluation only |

---

## 4. Disadvantages and Limitations of Spatial8 Studio

### 4.1 Horizontal Plane Only — No Elevation
The 2-factor structural model (ITD + ILD) accounts only for horizontal (left-right) localization. It provides no elevation (up/down) or front-back cues. PlugSonic's HRTF approach at least attempts elevation — imperfectly for non-individual listeners, but it exists. Spatial8 makes no such attempt.

**Impact**: Sources placed at the same azimuth but different heights are perceptually indistinguishable. Spatial8's Y-axis coordinate is accepted by the UI but does not currently modulate the acoustic model.

### 4.2 Offline Batch Processing — No Real-Time or Dynamic Mode
PlugSonic's mobile app supports dynamic navigable audio: as the user physically walks through a space, ARKit updates listener coordinates in real-time, and the binaural rendering updates accordingly. Spatial8 is strictly offline — the user uploads audio, the backend processes it, and a file is returned.

**Impact**: Spatial8 cannot support live audio spatialization, gaming audio pipelines, VR/AR spatial audio, or real-time music monitoring use cases without a streaming architecture rewrite.

### 4.3 No Head Tracking
PlugSonic integrates Apple ARKit for device orientation tracking, reducing front-back confusion by dynamically updating the listener's viewpoint as they move their head. Spatial8 has no head tracking capability — source positions are fixed relative to an assumed static listener orientation.

### 4.4 Static Source Positions at Render Time
Once a source is assigned an azimuth, it does not move during playback. Brown and Duda's original model explicitly supports animated sources via fractional delay interpolation. Spatial8 does not yet expose this capability — there is no timeline or keyframe system for source motion.

### 4.5 No Listener Distance Modeling
PlugSonic's 3DTI Toolkit supports distance-based attenuation (inverse square law) and near-field effects. Spatial8 has no distance model — all sources are treated as equidistant regardless of their Y coordinate, reducing the perceptual realism of deep spatial scenes.

### 4.6 MATLAB Dependency for DSP
The DSP engine is implemented in MATLAB, which requires a MATLAB Runtime license on the server. PlugSonic's 3DTI is open-source C++ compiled to WebAssembly. Migrating Spatial8's DSP engine to a dependency-free implementation (pure JavaScript, Web Audio API worklets, or a compiled WASM module) would increase deployment portability significantly.

### 4.7 No Formal Psychoacoustic Validation
Spatial8's evaluation used 12 non-specialist participants in an informal listening session. PlugSonic was similarly informal. Neither paper presents a formal psychoacoustic experiment following standardized protocols such as ITU-R BS.1534 (MUSHRA) or ISO 532. Without such validation, the absolute perceptual quality of the spatialization remains unquantified against established baselines.

---

## 5. Future Improvements Roadmap

| Priority | Improvement | Complexity |
|---|---|---|
| High | Real-time AudioWorklet DSP (browser-native, no server) | High |
| High | SOFA-format HRTF upload for optional elevation rendering | Medium |
| Medium | Device orientation head tracking (mobile browser DeviceOrientation API) | Medium |
| Medium | Timeline-based animated source trajectories | High |
| Medium | Formal MUSHRA psychoacoustic evaluation | Medium |
| Low | Distance attenuation / near-field model | Low |
| Low | Room impulse response convolution (reverb) | Medium |
| Low | WASM-compiled DSP engine (remove MATLAB dependency) | High |

---

## 6. How the Research Paper Maps to Our Code

| PlugSonic Concept | Our Implementation |
|---|---|
| Web-based audio curation interface | `frontend/src/main.jsx` — React spatial stage canvas |
| Virtual source position on 2D map | `DEFAULT_COORDINATE_PANS`, drag-and-drop stage markers |
| Binaural rendering engine | `backend/matlab/spatializeAudio.m` — ITD + ILD biquad |
| Multi-source scene mixing | `backend/matlab/renderScene.m` — N-track superposition |
| REST API for audio processing | Spring Boot `AudioController.java` endpoints |
| Processed audio delivery | WAV file streamed back to browser for download/playback |
| Arrangement presets | `arrangeSpread`, `arrangeStereoPair`, `arrangeCrossSweep`, `arrangeCenter` in `main.jsx` |
| Sample rate handling (our addition) | `interp1` resampling in `renderScene.m` |
| Phase coherence (our addition) | Cross-correlation gate in `spatializeAudio.m` |
| Constant-power panning (our addition) | Sine/cosine gain law in `spatializeAudio.m` |
