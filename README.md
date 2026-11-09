# Spatial8 Studio · Left & Right Earphone Spatial Audio

Spatial8 Studio is a specialized web workstation and digital signal processing (DSP) engine designed for **binaural audio spatialization tailored specifically for left and right earphones**.

Unlike traditional 3-D audio engines that attempt to simulate elevation (above/below) and front/rear positioning using synthetic spectral tricks, Spatial8 focuses strictly on the **two physical psychoacoustic factors** that two-channel earphones can physically and unambiguously reproduce:
1. **Interaural Time Difference (ITD)**
2. **Interaural Level Difference (ILD)** & Acoustic Head Shadowing

---

## Table of Contents

1. [Psychoacoustics: Why Two Earphones Only Need Two Factors](#1-psychoacoustics-why-two-earphones-only-need-two-factors)
2. [Pulse-Code Modulation (PCM) Explained](#2-pulse-code-modulation-pcm-explained)
3. [HRTF and HRIR in Theory and Practice](#3-hrtf-and-hrir-in-theory-and-practice)
4. [The Two Physical Factors: Mathematical Modeling](#4-the-two-physical-factors-mathematical-modeling)
   - [Factor 1: Interaural Time Difference (ITD)](#factor-1-interaural-time-difference-itd)
   - [Factor 2: Interaural Level Difference (ILD) & Head Shadow](#factor-2-interaural-level-difference-ild--head-shadow)
5. [Concrete Worked Examples](#5-concrete-worked-examples)
   - [Example 1: Hard Left Earphone Source](#example-1-hard-left-earphone-source-theta--90)
   - [Example 2: Dead-Center In-Phase Source](#example-2-dead-center-in-phase-source-theta--0)
   - [Example 3: Dynamic Animated Sweep (Left to Right)](#example-3-dynamic-animated-sweep-left-to-right)
6. [System Architecture & Processing Pipeline](#6-system-architecture--processing-pipeline)
7. [Running Locally](#7-running-locally)

---

## 1. Psychoacoustics: Why Two Earphones Only Need Two Factors

When listening to audio through standard earphones or headphones, sound is delivered directly into the ear canals via two isolated acoustic transducers: the **Left** driver and the **Right** driver. There is zero acoustic crosstalk between ears in air.

### Why Elevation and Front/Back Cues Fail on Earphones

In free-field open air listening, humans distinguish whether a sound is above, below, in front, or behind through three mechanisms:
- **Pinna Filtering**: The microscopic ridges and folds of the outer ear (the pinna) reflect incoming sound waves. These reflections combine with direct sound to create direction-dependent notches and spectral peaks above $4\text{ kHz}$.
- **Torso and Shoulder Reflections**: Echoes bouncing off the chest and shoulders within $1\text{--}3\text{ ms}$.
- **Dynamic Head Tracking**: When we hear an ambiguous sound, our neck instinctively rotates by micro-degrees. The brain observes how ITD and ILD shift to resolve front versus rear ("the cone of confusion").

When listening through earphones:
1. **No Personalized Pinna**: Standard earphones bypass the pinna completely (in-ear monitors) or press against it (on-ear/over-ear). Applying an arbitrary synthetic "elevation notch" or "rear slapback" sounds like an unnatural, muffled graphic equalizer or comb-filtering distortion rather than true height.
2. **No Head Tracking**: Without real-time IMU gyroscopes adjusting the audio as your head moves, static front/back cues collapse inside the listener's head.

### The Two True Earphone Factors

Because earphones have exactly two output channels, lateral spatial positioning is governed purely and powerfully by:
- **Factor 1 (ITD)**: The arrival time difference of wavefronts reaching the left versus right ear.
- **Factor 2 (ILD)**: The sound pressure level attenuation and high-frequency head shadow between the ear facing the source and the ear facing away.

By mastering these two physical parameters, sound pans across the stereo field with crystalline clarity, punchy transients, and zero phase muddiness.

---

## 2. Pulse-Code Modulation (PCM) Explained

### What is PCM?

**Pulse-Code Modulation (PCM)** is the digital representation of raw, uncompressed analog audio signals. An analog sound wave is continuous in both time and amplitude. PCM converts it into a discrete-time sequence of numerical amplitudes by:
1. **Sampling**: Measuring the wave amplitude at uniformly spaced time intervals $T = \frac{1}{f_s}$, where $f_s$ is the sampling rate.
2. **Quantization**: Rounding each measured continuous amplitude to the nearest integer value defined by the bit depth.

```
Analog Waveform:      ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
Discrete Sampling:    |   |   |   |   |   |
Quantized PCM:       [+0.12, +0.65, +0.94, +0.41, -0.22, -0.87]
```

### Sampling Rates ($f_s$) and the Nyquist-Shannon Theorem

The **Nyquist-Shannon Sampling Theorem** states that to perfectly reconstruct an analog signal containing frequencies up to $f_{\text{max}}$, the sampling frequency $f_s$ must satisfy:
$$f_s \ge 2 f_{\text{max}}$$

- Human hearing upper limit: $\approx 20\text{ kHz}$.
- Standard CD Audio rate: $44.1\text{ kHz}$ ($2 \times 20\text{ kHz} = 40\text{ kHz}$, with a $4.1\text{ kHz}$ guard band for anti-aliasing low-pass filters).
- Professional Studio rate: $48\text{ kHz}$ or $96\text{ kHz}$.
- Time interval between samples at $44.1\text{ kHz}$:
  $$T_s = \frac{1}{44100} \approx 22.6757\ \mu\text{s}$$

### Bit Depth and Dynamic Range

Bit depth determines the resolution of each sample's amplitude and the noise floor:
- **16-bit Linear PCM**: $2^{16} = 65,536$ discrete amplitude steps. Dynamic range $\approx 6.02 \times 16 \approx 96.3\text{ dB}$.
- **24-bit Linear PCM**: $2^{24} = 16,777,216$ discrete amplitude steps. Dynamic range $\approx 144.5\text{ dB}$.
- **32-bit Floating-Point PCM**: Uses IEEE 754 float representation (1 sign bit, 8 exponent bits, 23 mantissa bits). Amplitudes range between $-1.0$ and $+1.0$, preventing digital clipping during intermediate DSP convolution.

### Why Must Compressed Audio (MP3/WAV) Be Decoded to PCM?

MP3 files are **lossy, perceptual bitstreams**. They discard imperceptible audio details using Modified Discrete Cosine Transforms (MDCT) and Huffman coding. You cannot perform digital filtering or time delays directly on an MP3 bitstream.

To spatialize an MP3:
1. FFmpeg decodes the MP3 frames into uncompressed 32-bit float or 24-bit linear PCM vectors:
   $$x[n] \in [-1.0, +1.0], \quad n = 0, 1, 2, \dots, N-1$$
2. The DSP engine processes the raw PCM buffers through time-delay interpolation and finite impulse response (FIR) filtering.
3. The resulting stereo PCM buffers $[y_L[n], y_R[n]]$ are peak-normalized.
4. FFmpeg/LAME encodes the processed PCM buffers back into a high-bitrate ($320\text{ kbps}$) MP3 file.

---

## 3. HRTF and HRIR in Theory and Practice

### Definitions

- **HRTF (Head-Related Transfer Function)**: The complex frequency-domain response $H(f, \theta, \phi)$ describing how a sound wave from azimuth $\theta$ and elevation $\phi$ is filtered by the head and ears before reaching the eardrum:
  $$H(f) = |H(f)| e^{j \Phi(f)}$$
  where $|H(f)|$ represents magnitude (ILD) and $\Phi(f)$ represents phase delay (ITD).
- **HRIR (Head-Related Impulse Response)**: The inverse Fourier transform of the HRTF into the discrete-time domain:
  $$h[n] = \mathcal{F}^{-1}\{H(f)\}$$
  An HRIR is a finite impulse response (FIR) filter representing the acoustic response of the ear to an instantaneous Dirac delta click $\delta[n]$.

### Convolution in Discrete Time

Filtering an input audio PCM signal $x[n]$ with an impulse response $h[n]$ of length $M$ is computed via discrete-time linear convolution:
$$y[n] = (x * h)[n] = \sum_{k=0}^{M-1} x[n - k] \cdot h[k]$$

For two earphones, we calculate two distinct signals:
$$y_L[n] = (x * h_L)[n]$$
$$y_R[n] = (x * h_R)[n]$$

---

## 4. The Two Physical Factors: Mathematical Modeling

### Factor 1: Interaural Time Difference (ITD)

When a sound source is positioned at angle $\theta$ relative to the forward direction, sound waves travel an extra path length $\Delta d$ to reach the farther ear.

```
               Sound Source
                 \
                  \
                   \
               [ L Ear ]
              /         \
             |   Head    |
              \         /
               [ R Ear ]  <--- Extra distance d traveled!
```

#### Woodworth's Spherical Head Formula

Using a spherical head approximation of radius $r \approx 0.0875\text{ m}$ ($8.75\text{ cm}$) and speed of sound $c = 343\text{ m/s}$:
$$\tau(\theta) = \frac{r}{c} (\theta_{\text{rad}} + \sin\theta_{\text{rad}})$$

- For a source directly ahead ($\theta = 0^\circ = 0\text{ rad}$):
  $$\tau(0) = \frac{0.0875}{343} (0 + 0) = 0.00\text{ ms}$$
- For a source at full left ($\theta = 90^\circ = \frac{\pi}{2}\text{ rad}$):
  $$\tau\left(\frac{\pi}{2}\right) = \frac{0.0875}{343} \left(\frac{\pi}{2} + \sin\frac{\pi}{2}\right) \approx 0.0002551 \times (1.5708 + 1) \approx 0.6558\text{ ms}$$

At $44,100\text{ Hz}$, the maximum sample delay is:
$$D_{\text{samples}} = \tau \times f_s = 0.0006558 \times 44100 \approx 28.92\text{ samples}$$

#### Fractional Delay Interpolation

Because $D_{\text{samples}}$ is non-integer ($28.92$ samples), truncating or rounding to the nearest integer would cause audible pitch fluttering (phase jitter). We apply first-order fractional delay interpolation:
Let $D = \lfloor D \rfloor + f$, where $\lfloor D \rfloor = 28$ and fraction $f = 0.92$:
$$y[n] = (1 - f) \cdot x[n - \lfloor D \rfloor] + f \cdot x[n - \lfloor D \rfloor - 1]$$

This achieves sub-sample temporal precision with zero phase artifacts.

---

### Factor 2: Interaural Level Difference (ILD) & Head Shadow

Sound pressure drops across distance, and the human head acts as an acoustic baffle that obstructs high frequencies.

#### Level Attenuation

For lateral angle $\theta \in [-90^\circ, +90^\circ]$, the farther ear experiences an overall level reduction $\Delta L$:
$$\Delta L(\theta) = \min\left(9.0,\ \frac{|\theta|}{90} \times 8.5\right)\text{ dB}$$
$$G_{\text{far}}(\theta) = 10^{-\Delta L(\theta) / 20}$$

At $\theta = 90^\circ$ (full left):
$$G_{\text{far}} = 10^{-8.5 / 20} \approx 0.3758\quad (-8.5\text{ dB})$$

#### Acoustic Head Shadow (Frequency-Dependent Attenuation)

Wavelength is inversely proportional to frequency:
$$\lambda = \frac{c}{f}$$
- For low frequencies ($200\text{ Hz}$): $\lambda = \frac{343}{200} = 1.715\text{ m}$. The sound wave is vastly larger than the head diameter ($17.5\text{ cm}$), bending effortlessly around it (diffraction).
- For high frequencies ($3\text{ kHz}$): $\lambda = \frac{343}{3000} \approx 0.114\text{ m}$ ($11.4\text{ cm}$). The wave is smaller than the head, casting an acoustic shadow.

Spatial8 implements this physical shadow on the farther ear using a discrete-time one-pole spectral shelf filter ($f_c = 1500\text{ Hz}$):
$$\alpha = \exp\left(-\frac{2\pi f_c}{f_s}\right) = \exp\left(-\frac{2\pi \times 1500}{44100}\right) \approx 0.8077$$
$$\text{low}[n] = (1 - \alpha) x[n] + \alpha \cdot \text{low}[n-1]$$
$$\text{high}[n] = x[n] - \text{low}[n]$$
$$y_{\text{shadow}}[n] = \text{low}[n] + G_{\text{high}}(\theta) \cdot \text{high}[n]$$
where $G_{\text{high}}(\theta) = \max\left(0.20,\ 1.0 - 0.75 \frac{|\theta|}{90}\right)$.

---

## 5. Concrete Worked Examples

### Example 1: Hard Left Earphone Source ($\theta = +90^\circ$)

Suppose a user uploads a $1\text{ kHz}$ sine wave sampled at $44.1\text{ kHz}$ and places it at **100% Left**:

1. **Calculate ITD**:
   $$\tau = \frac{0.0875}{343} \left(\frac{\pi}{2} + 1\right) \approx 0.656\text{ ms} \implies D = 28.92\text{ samples}$$
   - Left Ear: $0\text{ samples}$ delay.
   - Right Ear: $28.92\text{ samples}$ delay.
2. **Calculate ILD & Head Shadow**:
   - Left Ear: Gain = $1.000$ ($0\text{ dB}$, full direct signal).
   - Right Ear: Overall attenuation $-8.5\text{ dB}$ ($G \approx 0.376$), high-frequency shelf gain $G_{\text{high}} = 0.25$ ($-12\text{ dB}$ on harmonics above $1.5\text{ kHz}$).
3. **Discrete PCM Result**:
   $$y_L[n] = x[n]$$
   $$y_R[n] = 0.376 \times \text{Filter}_{\text{shadow}}(0.08 x[n - 28] + 0.92 x[n - 29])$$
4. **Perception**: Sound snaps distinctly and comfortably into the left earphone, with natural spatial width rather than harsh mono hard-panning.

---

### Example 2: Dead-Center In-Phase Source ($\theta = 0^\circ$)

1. **Calculate ITD**:
   $$\tau(0) = 0.00\text{ ms} \implies D = 0\text{ samples}$$
2. **Calculate ILD**:
   $$\Delta L(0) = 0.0\text{ dB} \implies G = 1.000,\ G_{\text{high}} = 1.000$$
3. **Discrete PCM Result**:
   $$y_L[n] = x[n]$$
   $$y_R[n] = x[n]$$
4. **Perception**: The audio creates an exact phantom center image directly between both earphones, with zero phase cancellation or tonal coloration.

---

### Example 3: Dynamic Animated Sweep (Left to Right)

When a source is set to animate from Left ($\theta = +80^\circ$) to Right ($\theta = -80^\circ$) over $T = 6.0\text{ s}$:

1. Audio is processed in sequential blocks of $B = 1024\text{ samples}$ ($23.2\text{ ms}$ per block).
2. For each block $m$, the normalized progress $\lambda \in [0, 1]$ is computed:
   $$\theta[m] = (1 - \lambda) \cdot (+80^\circ) + \lambda \cdot (-80^\circ)$$
3. ITD delay samples $D[m]$ and ILD gains $G[m]$ update dynamically per block.
4. The fractional delay buffer smoothly interpolates the delay across blocks, producing a seamless, Doppler-clean sweep across the listener's head.

---

## 6. System Architecture & Processing Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                 Vite + React Client                         │
│   (Handcrafted Retro UI · Interactive Earphone Soundstage)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / Multipart
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Spring Boot REST API (Port 8080)            │
│  - Storage Management (`backend/storage/`)                   │
│  - Session Authentication & Community State                 │
│  - Single-threaded Background Render Worker                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Generates MATLAB Batch Script
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 MATLAB + FFmpeg DSP Core                    │
│  1. Decode MP3 -> Linear Float PCM via FFmpeg               │
│  2. Compute Block-by-Block Lateral Angle theta              │
│  3. Calculate Woodworth ITD (Fractional Delay Interpolation) │
│  4. Calculate ILD & Head Shadow (1-Pole Spectral Shelf)     │
│  5. Sum PCM Channels across Multiple Audio Sources          │
│  6. Peak Normalization (0.98 FS)                            │
│  7. Encode -> High-Bitrate Stereo MP3 via FFmpeg libmp3lame │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Running Locally

### Prerequisites

- **Java 21+** (`java -version`)
- **Maven 3.9+** (`mvn -version`)
- **Node.js 20+** (`node -v`)
- **MATLAB** (Optional for production spatial rendering; executable should be in PATH or configured via `SPATIA_MATLAB_COMMAND`)
- **FFmpeg** (`ffmpeg -version`)

### 1. Start the Backend

```powershell
cd backend
mvn spring-boot:run
```

The Spring Boot server starts at `http://localhost:8085`.

Demo account automatically seeded on startup:
- **Email**: `demo@gmail.com`
- **Password**: `demo@123`

### 2. Start the Frontend

```powershell
cd frontend
npm install
npm run dev
```

The client will start at `http://localhost:5173`. Open your browser, sign in with the demo account, and experience the handcrafted earphone spatializer!
