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
7. [The Median Plane Problem: How to Add Elevation, Front, and Rear (Future Roadmap)](#7-the-median-plane-problem-how-to-add-elevation-front-and-rear-future-roadmap)
   - [The Median Plane Paradox & The Cone of Confusion](#the-median-plane-paradox--the-cone-of-confusion)
   - [Technique 1: Monaural Pinna Spectral Filtering](#technique-1-monaural-pinna-spectral-filtering-directional-notches--shelves)
   - [Technique 2: Dynamic Head Tracking (Resolving Front/Back via Motion)](#technique-2-dynamic-head-tracking-resolving-frontback-via-motion)
   - [Technique 3: Binaural Room Impulse Responses (BRIR) & Early Reflections](#technique-3-binaural-room-impulse-responses-brir--early-reflections)
   - [Technique 4: Personalized HRTF via the SOFA Standard](#technique-4-personalized-hrtf-via-the-sofa-standard)
8. [Listening Without Earphones: Loudspeaker & Open-Air Differentiation](#8-listening-without-earphones-loudspeaker--open-air-differentiation)
   - [Acoustic Crosstalk: Earphones vs. Loudspeakers](#acoustic-crosstalk-earphones-vs-loudspeakers)
   - [How the Brain Differentiates Left vs. Right in Open Air](#how-the-brain-differentiates-left-vs-right-in-open-air)
   - [The Laptop and Smartphone Problem](#the-laptop-and-smartphone-problem)
   - [Software Solutions: Transaural Crosstalk Cancellation (XTC) & Mid-Side Shuffling](#software-solutions-transaural-crosstalk-cancellation-xtc--mid-side-shuffling)
9. [Deep Dive: Advanced Acoustic Physics & DSP Engineering](#9-deep-dive-advanced-acoustic-physics--dsp-engineering)
   - [The Duplex Theory of Sound Localization (Rayleigh Crossover)](#the-duplex-theory-of-sound-localization-rayleigh-crossover)
   - [In-Head Lateralization vs. Out-of-Head Externalization](#in-head-lateralization-vs-out-of-head-externalization)
   - [Distance Attenuation & Atmospheric Air Absorption](#distance-attenuation--atmospheric-air-absorption)
   - [Doppler Pitch Shift & Dynamic Fractional Delay Interpolation](#doppler-pitch-shift--dynamic-fractional-delay-interpolation)
   - [Stereo-to-Mono Downmix & Phase Cancellation Prevention](#stereo-to-mono-downmix--phase-cancellation-prevention)
   - [Server-Side MATLAB DSP vs. Client-Side Web Audio API](#server-side-matlab-dsp-vs-client-side-web-audio-api)
   - [Frequently Asked Questions (FAQ) & Troubleshooting](#frequently-asked-questions-faq--troubleshooting)
10. [Running Locally](#10-running-locally)

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

## 7. The Median Plane Problem: How to Add Elevation, Front, and Rear (Future Roadmap)

### The Median Plane Paradox & The Cone of Confusion

A fundamental principle of acoustics is that **interaural differences (ITD and ILD) can only differentiate lateral positions (Left vs. Right)**.

When a sound source lies on the **median sagittal plane** (directly in front, overhead/elevation, behind, or below):
- The distance from the source to the Left earphone equals the distance to the Right earphone.
- Therefore:
  $$\text{ITD} = 0.00\text{ ms}$$
  $$\text{ILD} = 0.0\text{ dB}$$
- **The left earphone and right earphone receive mathematically identical signals!**

This creates the classic psychoacoustic phenomenon known as the **Cone of Confusion**: for any given lateral angle, there is an entire cone of 3D spatial points where the sound arrives at both ears with the exact same time delay and sound level.

```
                  +Z (Above / Elevation)
                         ▲
                         │
      -X (Behind) ◄──────┼──────► +X (In Front)
                         │
                         ▼
                  -Z (Below / Nadir)
   (All points on this plane have ITD = 0ms and ILD = 0dB!)
```

Because stereo earphones cannot rely on Left-Right differences for elevation and front/rear, human hearing distinguishes these directions using **monaural spectral cues**, **head motion**, and **environmental acoustics**. Here is how we can implement these in future iterations:

---

### Technique 1: Monaural Pinna Spectral Filtering (Directional Notches & Shelves)

Even though Left and Right earphone signals are identical in timing and overall gain, the physical outer ear (pinna) and head cast angle-dependent acoustic shadows that filter *both* ears equally:

1. **Elevation (Above: $+30^\circ$ to $+90^\circ$)**:
   - Sound entering from above bounces off the concha floor and enters the ear canal with a characteristic **pinna elevation notch** between $6.5\text{ kHz}$ and $10\text{ kHz}$.
   - As elevation rises, the notch shifts upward in frequency:
     $$f_{\text{notch}}(\phi) \approx 6500 + 45 \cdot \phi^\circ\quad (\text{Hz})$$
   - Elevated sources also receive a boost in the upper "air" band ($>8\text{ kHz}$) due to direct unhindered line-of-sight to the eardrum.
   - **How to Implement in DSP**: Apply a symmetric parametric notch filter (biquad) to *both* channels whose center frequency shifts upward with elevation $Z$, paired with a gentle high-shelf boost ($+2\text{ to }+4\text{ dB}$).

2. **Below (Nadir: $-30^\circ$ to $-90^\circ$)**:
   - Sounds below the head are physically obstructed by the listener's shoulders, chest, and lower jaw.
   - High frequencies are absorbed, creating a distinct low-pass roll-off starting around $3\text{--}4\text{ kHz}$.
   - **How to Implement in DSP**: Apply an aggressive dual-ear high-frequency roll-off (shelf $G \approx -6\text{ to } -12\text{ dB}$ above $3\text{ kHz}$).

3. **In Front vs. Behind ($+X$ vs. $-X$)**:
   - **Front ($+X$)**: Sound enters the open ear canal directly. The acoustic resonance of the human ear canal creates a natural presence peak around $2.5\text{--}4.0\text{ kHz}$.
   - **Behind ($-X$)**: The rear flap of the ear (helix/antihelix) physically shadows the ear canal. Rear sounds lose high-frequency crispness above $2\text{ kHz}$ and exhibit a spectral dip around $3\text{ kHz}$.
   - **How to Implement in DSP**: Apply a rear head-shadow low-pass filter to both channels whenever $X < 0$, combined with a mild presence dip at $3\text{ kHz}$.

---

### Technique 2: Dynamic Head Tracking (Resolving Front/Back via Motion)

In the real world, nobody holds their head completely still. When a sound is ambiguous (front vs. back), the listener unconsciously rotates their neck by a fraction of a degree.

- If a sound is **in front** and you turn your head slightly to the left:
  - The sound shifts towards your **Right** earphone ($\text{ITD}_{\text{right}} < \text{ITD}_{\text{left}}$).
- If the sound is **behind** and you turn your head slightly to the left:
  - The sound shifts towards your **Left** earphone ($\text{ITD}_{\text{left}} < \text{ITD}_{\text{right}}$)!

The brain instantly compares the vestibular motion of the neck with the direction of ITD change to resolve front vs. back without ambiguity.

**Future Implementation**:
- Integrate Web Bluetooth / WebHID API with standard IMU motion-sensing earphones (Apple AirPods Spatial Audio, Sony 360, or a head-mounted Arduino MPU-6050).
- Dynamically rotate source azimuth $\theta(t)$ and elevation $\phi(t)$ in real time based on head yaw, pitch, and roll:
  $$\theta_{\text{perceived}} = \theta_{\text{source}} - \psi_{\text{head}}(t)$$
- This turns an ambiguous static front/back filter into an unmistakably localized 3D source.

---

### Technique 3: Binaural Room Impulse Responses (BRIR) & Early Reflections

In nature, human ears never hear a sound source in an absolute anechoic void. The brain uses early acoustic reflections bouncing off environmental surfaces to decode height and depth:

1. **Ceiling Reflections (Elevation Cue)**: Sound from an elevated source bounces off the ceiling and floor with an early delay of $3\text{--}7\text{ ms}$.
2. **Rear Boundary Reflections (Depth Cue)**: A source behind the listener creates a reflection off the front wall that arrives $10\text{--}25\text{ ms}$ later.
3. **How to Implement in DSP**:
   - Use the **Image-Source Method (ISM)** to compute early reflection delay taps:
     $$\Delta t_{\text{ceiling}} = \frac{2 \cdot h_{\text{room}} - z_{\text{source}}}{c}$$
   - Sum these early reflections into both earphone channels with appropriate boundary absorption filters.

---

### Technique 4: Personalized HRTF via the SOFA Standard

Because every human being has a unique ear shape (like a retinal scan), generic pinna notches can sound unnatural or cause nausea for some listeners.

**Future Implementation**:
- Add support for the **SOFA (Spatially Oriented Format for Acoustics - AES69 standard)** file format.
- Allow users to import their own personalized measured HRTF dataset (captured via in-ear microphones in an anechoic chamber or estimated via smartphone ear-photogrammetry 3D mesh simulations).
- Fast spherical-harmonics or barycentric interpolation on the measured 3D grid.

---

## 8. Listening Without Earphones: Loudspeaker & Open-Air Differentiation

A common and critical question in spatial audio is: **What happens when a listener is NOT using earphones?** How can someone differentiate Left versus Right when listening through desktop monitor speakers, laptop speakers, or a mobile phone?

---

### Acoustic Crosstalk: Earphones vs. Loudspeakers

The fundamental physical difference between earphones and open-air loudspeakers is **channel isolation**:

```
EARPHONES (Isolated Binaural Delivery):
  [Left Earphone]  ────────────────────────► Left Ear Canal  (100% direct)
  [Right Earphone] ────────────────────────► Right Ear Canal (100% direct)
  Result: Infinite channel separation. Zero acoustic crosstalk.

LOUDSPEAKERS (Open-Air Acoustic Delivery):
  [Left Speaker]   ───┬────────────────────► Left Ear  (Direct Path d_L)
                      └─────────\
                                 \─────────► Right Ear (Crosstalk Path d_cross)
  [Right Speaker]  ───┬────────────────────► Right Ear (Direct Path d_R)
                      └─────────/
                                 /─────────► Left Ear  (Crosstalk Path d_cross)
  Result: BOTH ears hear BOTH speakers!
```

In open air, when the Left speaker plays a sound, the acoustic wave hits the **Left ear first** ($d_L$). However, that same wavefront continues travelling around the front of the head and hits the **Right ear** a fraction of a millisecond later ($\approx 0.22\text{--}0.28\text{ ms}$ delay) with slight head-shadow attenuation. This phenomenon is known as **Acoustic Transaural Crosstalk**.

---

### How the Brain Differentiates Left vs. Right in Open Air

Even with acoustic crosstalk, a listener without earphones can still tell Left from Right thanks to three primary psychoacoustic mechanisms:

#### 1. The Precedence Effect (Haas Effect / Law of the First Wavefront)
When a sound is panned toward the Left speaker, the sound wave arrives at both the left and right ears from the Left speaker **before** the Right speaker produces its sound (or the Left speaker's output arrives with higher amplitude).
- The human auditory cortex detects the earliest arriving wavefront ($t_0$) and **locks its directional perception to the source of that first wavefront**.
- Any sound arriving $1\text{ to }30\text{ ms}$ later from the other speaker is perceptually suppressed as an acoustic reflection rather than a distinct sound source.
- Result: You perceive the sound coming clearly from the Left.

#### 2. Stereophonic Level Differences (ILD across the Sweet Spot)
When listening in the center "sweet spot" between two stereo speakers (forming an equilateral triangle with the listener at $\pm 30^\circ$ angles):
- If the Left speaker plays at $0\text{ dB}$ and the Right speaker is attenuated by $-8.5\text{ dB}$, the sound pressure level hitting the left side of your head is noticeably stronger than the right.
- This creates an unmistakable physical level disparity that localizes the sound on the left side of the room.

#### 3. Natural Biological HRTF
When you listen through earphones, the sound bypasses your outer ear and head. Software must simulate an artificial HRTF.
- In contrast, when listening to real physical loudspeakers in a room, **you do not need an artificial HRTF**!
- The sound waves travel through real physical air and bounce off your real physical ears, face, and shoulders. Your own biological body applies the true, perfect physical acoustic filtering naturally.

---

### The Laptop and Smartphone Problem

While high-quality desktop stereo speakers placed $1.5\text{ m}$ apart deliver great stereo width, **laptop speakers and smartphones introduce major challenges**:
1. **Narrow Physical Separation**: Laptop speakers are only $15\text{--}25\text{ cm}$ apart. The angle subtended at the listener's head is tiny ($\pm 8^\circ\text{ to }\pm 12^\circ$).
2. **Extreme Crosstalk**: The path length from the Left speaker to the Left ear is nearly identical to the path length to the Right ear ($d_L \approx d_{\text{cross}}$).
3. **Phase Comb Filtering**: If pure earphone ITD (delay $\tau \approx 0.65\text{ ms}$) is played over closely spaced laptop speakers without compensation, the delayed right-channel audio combines with the crosstalk in air, producing audible **comb-filtering (hollow, flanging, or phasey artifacts)**.

---

### Software Solutions: Transaural Crosstalk Cancellation (XTC) & Mid-Side Shuffling

To make binaural audio project outside the physical borders of laptop or desktop speakers without wearing earphones, modern spatial audio DSP uses two techniques:

#### 1. Transaural Crosstalk Cancellation (XTC - Atal & Schroeder Recursive Algorithm)
To eliminate the unwanted crosstalk sound leaking from the Left speaker into the Right ear, the DSP injects an **anti-phase cancellation wave** into the opposite speaker:
$$y_L(t) = x_L(t) - C(t) * y_R(t)$$
$$y_R(t) = x_R(t) - C(t) * y_L(t)$$
where $C(t)$ is the acoustic transfer function modeling the delay and head-shadow between the two ears across the open room.

- The Left speaker plays the sound $x_L(t)$.
- The Right speaker simultaneously plays an inverted anti-sound $-C(t) * x_L(t)$ timed precisely so that when the Left speaker's wave reaches your right ear, the anti-sound arrives at the exact same microsecond and **destructively cancels it in mid-air**!
- Result: Only your left ear hears the left speaker's sound. The binaural illusion reappears in open space!

#### 2. Mid-Side (M/S) Blumlein Shuffler & Stereo Widening
For laptop and phone speakers, audio can be decomposed into **Mid (sum)** and **Side (difference)** channels:
$$M = \frac{L + R}{2}\quad (\text{Center / In-Phase mono signal})$$
$$S = \frac{L - R}{2}\quad (\text{Stereo difference / Spatial width signal})$$

- By boosting the Side signal $S$ with a low-frequency shelf filter below $700\text{ Hz}$, the apparent acoustic width expands well beyond the physical width of the laptop body.

---

### Playback Hardware Comparison Matrix

| Playback Device | Channel Separation | Crosstalk Mechanism | How Left/Right is Perceived | Best Spatial Mode |
| :--- | :--- | :--- | :--- | :--- |
| **In-Ear Earphones** | Infinite ($>90\text{ dB}$) | None (isolated ear canals) | Direct Woodworth ITD delay ($\approx 0.65\text{ ms}$) & ILD attenuation | Pure 2-Factor Binaural (Spatial8 Core) |
| **Over-Ear Headphones** | High ($>60\text{ dB}$) | Minimal mechanical headband coupling | Direct ITD & ILD + slight natural ear cup resonance | Pure 2-Factor Binaural (Spatial8 Core) |
| **Desktop Stereo Speakers** | Medium ($\approx 12\text{--}18\text{ dB}$) | Open-air acoustic crosstalk ($0.25\text{ ms}$ delay) | Precedence/Haas effect & real physical room acoustics | Blumlein Stereo Panning or Transaural XTC |
| **Laptop / Tablet Speakers** | Low ($\approx 3\text{--}6\text{ dB}$) | High crosstalk (narrow $\pm 10^\circ$ angle) | Level difference primarily; phase cues can sound hollow | Mid-Side (M/S) Stereo Widener + High ILD |
| **Single Mono Bluetooth Speaker** | None ($0\text{ dB}$) | Full mono sum ($L + R$) | Cannot perceive L/R physically; requires visual meters | Summed Mono Mixdown |

---

## 9. Deep Dive: Advanced Acoustic Physics & DSP Engineering

Spatial audio processing at the earphone boundary intersects wave physics, neurophysiology, and discrete-time signal processing. This section details the advanced mathematical principles and digital filters powering the spatial engine.

---

### The Duplex Theory of Sound Localization (Rayleigh Crossover)

Formulated by **Lord Rayleigh in 1907**, the Duplex Theory dictates that human sound localization relies on two complementary physical mechanisms segregated by acoustic wavelength $\lambda$:

```
                         THE RAYLEIGH DUPLEX SPECTRUM
   0 Hz                  800 Hz        1.5 kHz                      20 kHz
   ├────────────────────────┼─────────────┼───────────────────────────┤
   │◄────── ITD DOMINATES ───────────────►│                           │
   │  Wavelength λ > Head Diameter (2a)   │   Localization            │
   │  Diffraction wraps around skull      │   Ambiguity Zone          │
   │  MSO neural phase-locking            │   (Highest error)         │
   │                                      │◄────── ILD DOMINATES ────►│
   │                                      │  Wavelength λ < Head (2a) │
   │                                      │  Acoustic shadow cast     │
   │                                      │  LSO level comparison     │
```

#### 1. Low-Frequency Regime ($f < 1500\text{ Hz}$): Phase & ITD
For an average human head radius $a \approx 0.0875\text{ m}$ (head diameter $2a \approx 17.5\text{ cm}$), the wavelength of a $1500\text{ Hz}$ tone is:
$$\lambda = \frac{c}{f} = \frac{343\text{ m/s}}{1500\text{ s}^{-1}} \approx 0.228\text{ m} = 22.8\text{ cm}$$

Because $\lambda > 2a$, acoustic wavefronts bend easily around the skull via **diffraction**. There is almost zero acoustic shadow or sound level loss between the ears (attenuation $< 1\text{--}2\text{ dB}$). However, the interaural phase difference $\Delta \phi$:
$$\Delta \phi = 2\pi f \cdot \text{ITD} < 2\pi (1500) (0.00065) \approx 1.95\pi \text{ rad}$$
remains physiologically decipherable. Inside the brainstem, neurons in the **Medial Superior Olive (MSO)** utilize coincidence detection circuitry to time action potentials down to $\approx 10\text{ microseconds}$ accuracy!

#### 2. High-Frequency Regime ($f > 1500\text{ Hz}$): Head Shadow & ILD
When frequency rises above $1.5\text{ kHz}$, the acoustic wavelength becomes significantly shorter than the diameter of the head ($\lambda < 17.5\text{ cm}$). Two critical physical phenomena occur:
1. **Spatial Aliasing (Phase Ambiguity)**: The phase shift between ears exceeds $\pi$ radians ($180^\circ$). The brain cannot tell whether the wave at the far ear is lagging by half a cycle or leading by an entire full cycle. Phase cues become ambiguous.
2. **Acoustic Shadowing**: The head acts as a solid rigid obstacle. The incident sound wave is reflected off the near ear side, while the contralateral (far) ear falls into an acoustic "blind spot" or shadow zone.

The brain switches localization mechanisms to the **Lateral Superior Olive (LSO)**, which compares high-frequency sound energy levels. Head shadow attenuation can exceed **$15\text{ to }20\text{ dB}$** above $4\text{ kHz}$.

#### 3. The $1.5\text{ kHz}$ Crossover Zone
Between $1000\text{ Hz}$ and $2000\text{ Hz}$, both ITD phase tracking degrades (due to the refractory period limit of auditory nerve firing) and ILD shadowing is still forming ($2\text{--}5\text{ dB}$). Localization acuity (Minimum Audible Angle, MAA) is measurably worst in this frequency band ($\approx 3^\circ\text{ to }5^\circ$, compared to $< 1^\circ$ at $500\text{ Hz}$).

---

### In-Head Lateralization vs. Out-of-Head Externalization

A classic challenge in headphone audio is the distinction between **lateralization** and **externalization**:

- **Lateralization (Inside the Head)**: Sound appears to originate along an imaginary axis connecting the two ears inside the listener's skull. Pure synthetic ITD and ILD cues without room acoustics invariably produce lateralization.
- **Externalization (Outside the Head)**: The sound source is perceived as an acoustic object located out in 3D physical space, detached from the listener's body.

```
       LATERALIZATION                          EXTERNALIZATION
     (Dry Earphone Cues)                   (Binaural + Reflections)

           Contralateral                       Contralateral
                 │                                   │
       ┌─────────┴─────────┐               ┌─────────┴─────────┐
       │   [L]   ●   [R]   │               │   [L]       [R]   │
       └───────────────────┘               └───────────────────┘
                 ▲                                   ▲
                 │                                   │
       Sound perceived inside              Sound perceived 2m away
         listener's skull                    in the virtual room
```

#### Why Does Anechoic Sound Collapse Inside the Skull?
In the real world, an acoustic sound source is never completely dry; sound bounces off walls, floor, and ceilings. Furthermore, human ears are constantly undergoing minute micro-movements ($< 0.5^\circ$ head tremors). When a sound is panned purely via static dry delay and attenuation:
1. The **Direct-to-Reverberant Ratio (DRR)** is infinite (zero reflections). In physical nature, an infinite DRR only occurs if the source is pressed directly against the ear eardrum.
2. Spectral cues lack pinna reflections.

#### How Spatial8 Solves Externalization
Spatial8 bridges this psychoacoustic gap by allowing an optional **Room Boundary Simulator**:
- Generates 4 early specular reflections ($t < 35\text{ ms}$) corresponding to virtual room boundaries.
- The reflections arrive with asymmetrical ITD delays and inverted low-level ILD, signaling to the brainstem that the source exists in an external enclosure.

---

### Distance Attenuation & Atmospheric Air Absorption

Sound spatialization is incomplete without accurate radial distance modeling $r = \sqrt{X^2 + Y^2}$.

#### 1. The Inverse Square Law (Free-Field Geometric Divergence)
For an ideal point source emitting acoustic power $P_{\text{source}}$ into free space, sound intensity $I(r)$ drops with the surface area of an expanding sphere ($4\pi r^2$):
$$I(r) = \frac{P_{\text{source}}}{4\pi r^2}$$

Expressed in decibels of Sound Pressure Level (SPL):
$$\text{SPL}(r) = \text{SPL}(r_0) - 20\log_{10}\left(\frac{r}{r_0}\right)$$

Every doubling of distance reduces sound pressure by exactly **$6.02\text{ dB}$**.

#### 2. Near-Field Singularity Clamping
As an audio source approaches $r \to 0$, the inverse distance formula $\frac{1}{r} \to \infty$, causing mathematical clipping and digital distortion. Spatial8 implements a **minimum distance clamp**:
$$g_{\text{dist}}(r) = \frac{r_0}{\max(r, r_{\text{min}})}, \quad \text{where } r_{\text{min}} = 0.5\text{ m}, \; r_0 = 1.0\text{ m}$$

#### 3. Atmospheric Air Absorption (High-Frequency Damping)
In real air, acoustic energy dissipates due to molecular relaxation of Nitrogen ($N_2$) and Oxygen ($O_2$), as well as classical viscous losses. High frequencies attenuate dramatically faster over distance than bass frequencies:

$$\alpha(f) \approx \gamma_{\text{classical}} f^2 + \gamma_{\text{mol}} \frac{f_r f^2}{f_r^2 + f^2}$$

At a distance of $30\text{ m}$, a $10\text{ kHz}$ treble tone loses over $6\text{ dB}$ more energy than a $500\text{ Hz}$ tone. Spatial8 models this atmospheric air absorption with a distance-proportional digital lowpass filter:
$$H_{\text{air}}(z) = \frac{1 - k(r)}{1 - k(r) z^{-1}}, \quad k(r) = 1 - e^{-\beta r}$$
As distance $r$ increases, the cutoff frequency gracefully sweeps downward, giving distant sound sources realistic warmth and air-damping.

---

### Doppler Pitch Shift & Dynamic Fractional Delay Interpolation

When a sound source moves relative to the listener, two phenomena occur simultaneously:
1. Dynamic change in arrival time $\tau(t)$ (Doppler effect).
2. Continuous modulation of the ITD delay buffer.

#### 1. The Doppler Effect Equation
If the sound source moves with velocity vector $\vec{v}_s$ relative to the listener:
$$f_{\text{observed}} = f_{\text{emitted}} \cdot \left(\frac{c}{c - \vec{v}_s \cdot \hat{u}_r}\right)$$
where $c = 343\text{ m/s}$ and $\hat{u}_r$ is the unit vector pointing from source to listener.

#### 2. Digital Implementation: Avoiding "Zipper Noise"
In a discrete-time delay line, audio samples are stored in a circular memory buffer. If the delay $\tau[n] = D[n] / f_s$ changes dynamically, rounding $D[n]$ to the nearest integer sample causes **discontinuous jumps in buffer read pointers**. This manifests as audible clicking, popping, and harsh "zipper noise".

Spatial8 implements **Fractional Delay Interpolation**:
Given a fractional sample delay $D_{\text{total}} = D_{\text{int}} + \mu$, where $D_{\text{int}} = \lfloor D_{\text{total}} \rfloor$ and $0 \le \mu < 1$:

1. **Linear Interpolation**:
   $$y[n] = (1 - \mu) \cdot x[n - D_{\text{int}}] + \mu \cdot x[n - D_{\text{int}} - 1]$$
2. **Cubic Hermite Spline (for Studio-Grade Fidelity)**:
   $$y[n] = c_0 x[n - D_{\text{int}} + 1] + c_1 x[n - D_{\text{int}}] + c_2 x[n - D_{\text{int}} - 1] + c_3 x[n - D_{\text{int}} - 2]$$

Fractional interpolation guarantees that dynamically moving sources transition smoothly across the stereo field without digital artifacts or phase tearing.

---

### Stereo-to-Mono Downmix & Phase Cancellation Prevention

Commercial music tracks are mastered in stereo with existing panning, phase widening, and artificial reverb. Feeding a pre-panned stereo file directly into a spatial audio engine creates severe acoustic artifacts:
- If a sound is panned hard-left in the original recording, and the user positions the spatial source to the hard-right, the earphone outputs become conflicting and unnatural.
- Left and right channels may contain out-of-phase elements ($180^\circ$ inversion) designed to create a wide stereo image on ordinary speakers.

#### 1. The Phase Cancellation Threat
If an engine performs a naive mono mixdown:
$$x_{\text{naive}}[n] = \frac{L[n] + R[n]}{2}$$
any out-of-phase material ($L[n] = -R[n]$) will **destructively cancel into total silence**!

#### 2. The Spatial8 Phase-Coherent Downmixer
Spatial8 protects input material by analyzing the inter-channel normalized cross-correlation coefficient:
$$\rho_{LR} = \frac{\sum L[n] R[n]}{\sqrt{\sum L[n]^2 \cdot \sum R[n]^2}}$$

- **When $\rho_{LR} \ge 0$ (In-phase stereo)**: Standard coherent mono summation is applied:
  $$x_{\text{mono}}[n] = \frac{L[n] + R[n]}{\sqrt{2}}$$
- **When $\rho_{LR} < 0$ (Phase-inverted or anti-phase stereo)**: Spatial8 applies a $90^\circ$ Hilbert phase rotation to the Right channel before summing:
  $$x_{\text{mono}}[n] = \frac{L[n] + \mathcal{H}\{R[n]\}}{\sqrt{2}}$$
  This prevents destructive zero-cancellation while preserving full spectral energy across both channels.

---

### Server-Side MATLAB DSP vs. Client-Side Web Audio API

Spatial8 utilizes a hybrid architecture: real-time interactive previews on the frontend, with authoritative high-precision rendering on the backend via MATLAB.

| Feature / Metric | Client-Side Web Audio API | Server-Side MATLAB DSP Engine |
| :--- | :--- | :--- |
| **Numeric Precision** | 32-bit single-precision floating point | **64-bit double-precision IEEE 754** |
| **FFT Implementation** | Browser-dependent WebAssembly or vendor C++ | **Intel MKL / FFTW (maximum numerical precision)** |
| **Fractional Delay Filtering** | Linear sample interpolation or basic delay node | **Multi-tap FIR / Sinc-interpolated fractional delay** |
| **Head Shadow Model** | Basic biquad high-shelf approximations | **Spherical Head Diffraction & Woodworth Ray Tracing** |
| **Batch Processing & Export** | Limited by client CPU and browser memory limits | **Unconstrained multi-threaded offline rendering** |
| **File Format Support** | Dependent on browser codecs (WebM, basic WAV) | **Pristine multi-format encoding via FFmpeg (FLAC, MP3, WAV)** |
| **Determinism & Reproducibility**| Varies across Chrome, Firefox, Safari, and OS audio engines | **100% bit-exact, deterministic audio pipelines** |

---

### Frequently Asked Questions (FAQ) & Troubleshooting

#### Q1: Why does a sound positioned dead-center ($Y = 0$) sound slightly louder than when panned hard to one side?
This is governed by the **Pan Law**. When sound is centered, both earphones play the signal at full amplitude ($0\text{ dB}$ attenuation). When summed acoustically in the brain, two identical signals yield a $+3\text{ dB}$ (incoherent) to $+6\text{ dB}$ (coherent) perceived volume boost. Spatial8 employs a **$-3\text{ dB}$ Constant Power Pan Law** compensation curve:
$$g_L(\theta) = \cos\left(\frac{\theta + 90^\circ}{180^\circ} \cdot \frac{\pi}{2}\right), \quad g_R(\theta) = \sin\left(\frac{\theta + 90^\circ}{180^\circ} \cdot \frac{\pi}{2}\right)$$
This ensures the perceived acoustic energy remains constant as the source traverses from left to right.

#### Q2: Can spatial audio damage earphones or hearing?
Spatial audio does not damage hardware; however, because ILD boosts high-frequency signals on the near ear while attenuating the far ear, extreme volume settings can cause ear fatigue. Spatial8 includes an automatic output peak limiter that prevents digital clipping above $0\text{ dBFS}$.

#### Q3: Why do other 3D audio apps sound "muffled" or "underwater"?
Many commercial spatial audio plugins attempt to simulate height or distance by aggressively slapping fixed lowpass filters and generic HRTF notches across the entire audio spectrum. Because these filters do not match your individual ear anatomy, your brain interprets the comb filtering as spectral coloration (muffling) rather than spatial distance. Spatial8 intentionally avoids arbitrary spectral butchering, maintaining crystal-clear hi-fi fidelity.

#### Q4: What is the minimum latency required for interactive spatialization?
For interactive panning, the total motion-to-sound latency must remain below **$20\text{ milliseconds}$**. If latency exceeds $50\text{ ms}$, the user perceives a disconnect between mouse movement and audio panning, inducing cognitive disorientation. Spatial8 achieves sub-$10\text{ ms}$ real-time UI response via Web Audio nodes while queuing full-quality renders to MATLAB.

#### Q5: Why is $44.1\text{ kHz}$ or $48\text{ kHz}$ sample rate standard?
According to the **Nyquist-Shannon Sampling Theorem**, a discrete system can accurately represent frequencies up to half its sample rate ($f_s / 2$). The human hearing threshold extends to $20\text{ kHz}$. A sample rate of $44.1\text{ kHz}$ provides a Nyquist limit of $22.05\text{ kHz}$, completely preserving all audible frequencies and allowing precise timing resolution down to $22.6\text{ microseconds}$ per sample.

---

## 10. Running Locally

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
