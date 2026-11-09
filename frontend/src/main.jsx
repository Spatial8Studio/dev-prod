import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------

const api = async (path, options = {}) => {
  const token = localStorage.getItem('spatia-token');
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
};

const download = async (path, filename) => {
  const token = localStorage.getItem('spatia-token');
  const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Download failed');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

// ---------------------------------------------------------------------------
// Psychoacoustic Calculations (2-Factor Earphone Model)
// ---------------------------------------------------------------------------

// pan is in [-1.0 (Full Right), +1.0 (Full Left)]
// Center is 0.0 (Equal balance in both earphones)
const calculateBinauralFactors = (pan) => {
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const absPan = Math.abs(clampedPan);
  const thetaRad = absPan * (Math.PI / 2); // 0 to pi/2

  // Factor 1: ITD via Woodworth spherical head model (r=8.75cm, c=343m/s)
  // tau = (r / c) * (theta + sin(theta))
  const itdMs = (0.0875 / 343) * (thetaRad + Math.sin(thetaRad)) * 1000;

  // Factor 2: ILD in dB (up to ~8.5 dB attenuation on far ear)
  const ildDb = Math.min(9.0, absPan * 8.5);

  return {
    pan: clampedPan,
    absPan,
    itdMs: Number(itdMs.toFixed(2)),
    ildDb: Number(ildDb.toFixed(1)),
    isLeftDominant: clampedPan > 0.02,
    isRightDominant: clampedPan < -0.02,
    isCenter: Math.abs(clampedPan) <= 0.02
  };
};

const formatPanDescription = (pan) => {
  if (Math.abs(pan) <= 0.02) return 'Center · Equal in Both Earphones';
  const percent = Math.round(Math.abs(pan) * 100);
  return pan > 0 ? `${percent}% Left Earphone` : `${percent}% Right Earphone`;
};

// Natural alternating coordinate distribution for multi-audio combining
const DEFAULT_COORDINATE_PANS = [0.70, -0.70, 0.00, 0.85, -0.85, 0.40, -0.40, 0.95, -0.95, 0.20, -0.20];

const newSource = (upload, existingCount = 0) => {
  const panIndex = existingCount % DEFAULT_COORDINATE_PANS.length;
  const initialPan = DEFAULT_COORDINATE_PANS[panIndex];
  const destPan = initialPan === 0 ? 0.6 : -initialPan;
  return {
    id: crypto.randomUUID(),
    upload,
    pan: initialPan,
    destinationPan: destPan,
    travelTime: 8.0
  };
};

const currentPanAtTime = (source, mode, time) => {
  if (!source) return 0;
  if (mode === 'fixed') return source.pan;
  const duration = Math.max(0.1, Number(source.travelTime) || 1);
  const cycleTime = Math.min(duration * 2, Math.max(0, time));
  const amount = cycleTime <= duration ? cycleTime / duration : 1 - ((cycleTime - duration) / duration);
  return source.pan * (1 - amount) + source.destinationPan * amount;
};

// ---------------------------------------------------------------------------
// Component: Interactive Earphone Soundstage
// ---------------------------------------------------------------------------

function EarphoneSoundstage({
  sources,
  selectedId,
  setSelectedId,
  updateSource,
  mode,
  timelineTime,
  duplicateSource,
  arrangeSpread,
  arrangeStereoPair,
  arrangeCrossSweep,
  arrangeCenter,
  setSources
}) {
  const stageRef = useRef(null);
  const selected = sources.find(s => s.id === selectedId);
  const activePan = selected ? currentPanAtTime(selected, mode, timelineTime) : 0;
  const factors = calculateBinauralFactors(activePan);

  // Dragging support along the soundstage line
  const handleStageClickOrDrag = (e) => {
    if (!selected || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const trackWidth = rect.width;
    // Map clickX (0 to trackWidth) to pan (+1.0 Left to -1.0 Right)
    // Left side (clickX = 0) is +1.0, Right side (clickX = trackWidth) is -1.0
    const ratio = Math.max(0, Math.min(1, clickX / trackWidth));
    const newPan = Number((1 - 2 * ratio).toFixed(2));
    updateSource(selected.id, { pan: newPan });
  };

  const handlePointerDown = (e, sourceId) => {
    e.stopPropagation();
    setSelectedId(sourceId);
  };

  return (
    <div className="soundstage-container">
      <div className="soundstage-header">
        <div>
          <span className="eyebrow">STEREO ACOUSTIC FIELD</span>
          <h2>Earphone Soundstage</h2>
        </div>
        <div className="stamp-badge red">
          {mode === 'animated' ? '◌ ANIMATED SWEEP PREVIEW' : '● FIXED POSITION'}
        </div>
      </div>

      {/* Multi-Track Arrangement Toolbar */}
      {sources.length > 1 && (
        <div className="stage-arrangement-presets">
          <span className="preset-label">STAGE PRESETS:</span>
          <button
            type="button"
            className="preset-btn"
            onClick={arrangeSpread}
            title="Distribute all loaded audios evenly between Left and Right"
          >
            ↔ Spread Evenly
          </button>
          <button
            type="button"
            className="preset-btn"
            onClick={arrangeStereoPair}
            title="Alternate audios Left & Right"
          >
            ⇄ Stereo Pair
          </button>
          {mode === 'animated' && (
            <button
              type="button"
              className="preset-btn"
              onClick={arrangeCrossSweep}
              title="Counterpoint sweeps (some Left→Right, others Right→Left)"
            >
              ↻ Cross-Sweeps
            </button>
          )}
          <button
            type="button"
            className="preset-btn"
            onClick={arrangeCenter}
            title="Reset all audios to center"
          >
            ⊙ Center All
          </button>
        </div>
      )}

      {/* Visual Stereo Soundstage Area */}
      <div
        className="soundstage-canvas-area"
        ref={stageRef}
        onClick={handleStageClickOrDrag}
        title="Click or drag anywhere on the stereo axis to place audio"
      >
        {/* Left Earphone Pod */}
        <div className="earphone-pod left-earphone">
          <div className="earphone-speaker">
            <span className="earphone-pod-badge">[L]</span>
          </div>
          <span className="stamp-badge">LEFT EAR</span>
        </div>

        {/* Right Earphone Pod */}
        <div className="earphone-pod right-earphone">
          <div className="earphone-speaker">
            <span className="earphone-pod-badge">[R]</span>
          </div>
          <span className="stamp-badge">RIGHT EAR</span>
        </div>

        {/* Center Listener Avatar */}
        <div className="listener-avatar">
          <div className="headphone-band" />
          <div className="listener-head">
            <div className="listener-nose" />
          </div>
          <span className="listener-label">YOU (0.0 Center)</span>
        </div>

        {/* Soundstage Axis Line */}
        <div className="stage-axis-track" />

        {/* Render Source Transit Line in Animated Mode */}
        {selected && mode === 'animated' && (
          <div
            className="token-line-transit"
            style={{
              left: `${((1 - Math.max(selected.pan, selected.destinationPan)) / 2) * 100}%`,
              width: `${(Math.abs(selected.pan - selected.destinationPan) / 2) * 100}%`
            }}
          />
        )}

        {/* Audio Source Tokens */}
        {sources.map((source, index) => {
          const isSelected = source.id === selectedId;
          const pan = currentPanAtTime(source, mode, timelineTime);
          // pan +1 (left) maps to 0% offset from left (plus padding), pan -1 maps to 100%
          const leftPercent = ((1 - pan) / 2) * 80 + 10; // keep inside stage margins

          return (
            <div
              key={source.id}
              className="audio-source-token"
              style={{ left: `${leftPercent}%` }}
              onPointerDown={(e) => handlePointerDown(e, source.id)}
            >
              <div className={`token-pin ${isSelected ? 'active-token' : ''}`}>
                <span>#{String(index + 1).padStart(2, '0')}</span>
                <small>{formatPanDescription(pan)}</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two Factors Telemetry HUD */}
      <div className="two-factors-hud">
        {/* Factor 1: ITD Card */}
        <div className="factor-card">
          <div className="factor-title-row">
            <strong>Factor 1: Arrival Time (ITD)</strong>
            <span className="stamp-badge blue">WOODWORTH MODEL</span>
          </div>
          <div className="factor-metric-grid">
            <div className="metric-cell">
              <span className="ear-tag">[L] LEFT EARPHONE</span>
              <strong className="metric-val">
                {factors.isRightDominant ? `+${factors.itdMs} ms` : '0.00 ms'}
              </strong>
              <small className="metric-detail">
                {factors.isRightDominant ? 'Delayed (Far Ear)' : 'Direct Wavefront'}
              </small>
            </div>
            <div className="metric-cell">
              <span className="ear-tag">[R] RIGHT EARPHONE</span>
              <strong className="metric-val">
                {factors.isLeftDominant ? `+${factors.itdMs} ms` : '0.00 ms'}
              </strong>
              <small className="metric-detail">
                {factors.isLeftDominant ? 'Delayed (Far Ear)' : 'Direct Wavefront'}
              </small>
            </div>
          </div>
        </div>

        {/* Factor 2: ILD Card */}
        <div className="factor-card">
          <div className="factor-title-row">
            <strong>Factor 2: Level & Head Shadow (ILD)</strong>
            <span className="stamp-badge blue">ACOUSTIC SHADOW</span>
          </div>
          <div className="factor-metric-grid">
            <div className="metric-cell">
              <span className="ear-tag">[L] LEFT EARPHONE</span>
              <strong className="metric-val">
                {factors.isRightDominant ? `-${factors.ildDb} dB` : '0.0 dB'}
              </strong>
              <small className="metric-detail">
                {factors.isRightDominant ? 'Acoustic Shadow (>1.5kHz cut)' : 'Full Direct Level'}
              </small>
            </div>
            <div className="metric-cell">
              <span className="ear-tag">[R] RIGHT EARPHONE</span>
              <strong className="metric-val">
                {factors.isLeftDominant ? `-${factors.ildDb} dB` : '0.0 dB'}
              </strong>
              <small className="metric-detail">
                {factors.isLeftDominant ? 'Acoustic Shadow (>1.5kHz cut)' : 'Full Direct Level'}
              </small>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Audio Spatial Roster */}
      {sources.length > 1 && (
        <div className="multi-audio-roster-card">
          <div className="card-heading-row">
            <div>
              <span className="eyebrow">MULTI-SOURCE SPATIAL MIXER</span>
              <strong style={{ fontSize: '13px' }}>Combined Audio Coordinates ({sources.length} Tracks)</strong>
            </div>
            <span className="stamp-badge">SUPERPOSITION ACTIVE</span>
          </div>
          <div className="roster-table-wrapper">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>AUDIO TAPE</th>
                  <th>EARPHONE POSITION</th>
                  <th>WOODWORTH ITD</th>
                  <th>HEAD SHADOW ILD</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src, idx) => {
                  const isCurSelected = src.id === selectedId;
                  const curPan = currentPanAtTime(src, mode, timelineTime);
                  const srcFactors = calculateBinauralFactors(curPan);
                  return (
                    <tr
                      key={src.id}
                      className={isCurSelected ? 'row-selected' : ''}
                      onClick={() => setSelectedId(src.id)}
                    >
                      <td>
                        <span className="track-num-stamp">#{String(idx + 1).padStart(2, '0')}</span>
                      </td>
                      <td className="track-name-cell">
                        <strong>{src.upload.filename}</strong>
                        <small>{mode === 'animated' ? `${src.travelTime}s sweep` : 'Static Position'}</small>
                      </td>
                      <td>
                        <span className="roster-pan-tag">
                          {formatPanDescription(curPan)}
                        </span>
                      </td>
                      <td>
                        <span className="roster-metric-tag blue">
                          {srcFactors.itdMs > 0
                            ? `Δt = ${srcFactors.itdMs} ms (${srcFactors.isLeftDominant ? 'R lags' : 'L lags'})`
                            : '0.00 ms (In-Phase)'}
                        </span>
                      </td>
                      <td>
                        <span className="roster-metric-tag red">
                          {srcFactors.ildDb > 0
                            ? `-${srcFactors.ildDb} dB (${srcFactors.isLeftDominant ? 'R shadow' : 'L shadow'})`
                            : '0.0 dB (Direct)'}
                        </span>
                      </td>
                      <td>
                        <div className="roster-actions">
                          <button
                            type="button"
                            className="roster-btn clone"
                            title="Clone track to opposite ear coordinate"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateSource(src.id);
                            }}
                          >
                            ⧉ Clone
                          </button>
                          <button
                            type="button"
                            className="roster-btn delete"
                            title="Remove track"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSources(items => items.filter(item => item.id !== src.id));
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: Tape Deck Timeline Transport
// ---------------------------------------------------------------------------

function TapeDeckTimeline({ sources, mode, time, setTime }) {
  const duration = Math.max(1, ...sources.map(s => Number(s.travelTime) || 1));
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || mode === 'fixed') return undefined;
    let frame;
    let last = performance.now();
    const tick = (now) => {
      const delta = (now - last) / 1000;
      last = now;
      setTime((prev) => {
        const next = prev + delta;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, mode, duration, setTime]);

  return (
    <div className="timeline-deck">
      <div className="deck-transport">
        <button
          className="primary"
          disabled={mode === 'fixed' || !sources.length}
          onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? '⏸ PAUSE TAPE' : '▶ PLAY TAPE'}
        </button>
        <button
          disabled={mode === 'fixed' || !sources.length}
          onClick={() => {
            setPlaying(false);
            setTime(0);
          }}
        >
          ■ RESET
        </button>
      </div>

      <div className="deck-scrubber">
        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={Math.min(time, duration)}
          disabled={!sources.length || mode === 'fixed'}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
        <span className="tape-counter">
          {time.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: Project Card (Archival Card Catalog Style)
// ---------------------------------------------------------------------------

function CatalogCard({ project, onLoad, onPublish, onAudio }) {
  return (
    <article className="catalog-card">
      <div className="catalog-card-header">
        <span className={`stamp-badge ${project.mode === 'animated' ? 'blue' : 'red'}`}>
          {project.mode === 'animated' ? 'ANIMATED SWEEP' : 'FIXED POINT'}
        </span>
        <span className={`stamp-badge ${project.published ? 'green' : ''}`}>
          {project.published ? 'PUBLISHED' : 'PRIVATE'}
        </span>
      </div>
      <h3>{project.title}</h3>
      <p>{project.description || 'A handcrafted binaural earphone sketch with no description.'}</p>
      <div className="catalog-card-meta">
        <span>ARTIST: {project.owner?.name || 'Unknown'}</span>
        <span>DATE: {new Date(project.updatedAt).toLocaleDateString()}</span>
      </div>
      <div className="catalog-card-actions">
        <button onClick={() => onLoad(project)}>Open in Studio</button>
        {onPublish && (
          <button onClick={() => onPublish(project)}>
            {project.published ? 'Retract' : 'Publish'}
          </button>
        )}
        {project.published && project.renderId && (
          <button className="primary" onClick={() => onAudio(project)}>
            Download MP3 ↓
          </button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Component: Studio
// ---------------------------------------------------------------------------

function Studio({ user, logout }) {
  const [view, setView] = useState('studio');
  const [mode, setMode] = useState('fixed');
  const [sources, setSources] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [timelineTime, setTimelineTime] = useState(0);
  const [render, setRender] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [discoverProjects, setDiscoverProjects] = useState([]);
  const [artists, setArtists] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [artistSearch, setArtistSearch] = useState('');
  const [projectModal, setProjectModal] = useState(false);
  const [projectForm, setProjectForm] = useState({ title: 'Earphone Binaural Sketch', description: '', published: false });

  const selected = sources.find(s => s.id === selectedId);
  const isRendering = render && ['queued', 'processing'].includes(render.status);

  const updateSource = (id, patch) => {
    setSources(items => items.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, ...patch };
      if (mode === 'fixed' && patch.pan !== undefined) {
        updated.destinationPan = patch.pan;
      }
      return updated;
    }));
  };

  const selectMode = (nextMode) => {
    setMode(nextMode);
    setTimelineTime(0);
    if (nextMode === 'fixed') {
      setSources(items => items.map(item => ({ ...item, destinationPan: item.pan })));
    }
  };

  // Poll render status
  useEffect(() => {
    if (!isRendering) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await api(`/api/audio/renders/${render.id}`);
        if (active) setRender(next);
      } catch (err) {
        if (active) setError(err.message);
      }
    };
    poll();
    const timer = setInterval(poll, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [render?.id, render?.status]);

  // Load projects & community
  useEffect(() => {
    let active = true;
    const query = encodeURIComponent(projectSearch);
    const artistQuery = encodeURIComponent(artistSearch);
    Promise.all([
      api('/api/projects/mine'),
      api(`/api/projects/discover?q=${query}`),
      api(`/api/artists?q=${artistQuery}`)
    ]).then(([mine, discover, artistList]) => {
      if (!active) return;
      setProjects(mine);
      setDiscoverProjects(discover);
      setArtists(artistList);
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectSearch, artistSearch]);

  const chooseFiles = async (event) => {
    const files = [...event.target.files];
    let currentSources = [...sources];
    for (const file of files) {
      try {
        const body = new FormData();
        body.append('file', file);
        const upload = await api('/api/audio/uploads', { method: 'POST', body });
        const source = newSource(upload, currentSources.length);
        if (mode === 'fixed') source.destinationPan = source.pan;
        currentSources = [...currentSources, source];
        setSelectedId(source.id);
        setView('studio');
      } catch (err) {
        setError(err.message);
      }
    }
    setSources(currentSources);
    event.target.value = '';
  };

  const duplicateSource = (sourceId) => {
    const orig = sources.find(s => s.id === sourceId);
    if (!orig) return;
    const cloned = {
      ...orig,
      id: crypto.randomUUID(),
      pan: Number((-orig.pan).toFixed(2)),
      destinationPan: Number((-orig.destinationPan).toFixed(2))
    };
    setSources(items => [...items, cloned]);
    setSelectedId(cloned.id);
  };

  const arrangeSpread = () => {
    if (sources.length <= 1) return;
    setSources(items => items.map((s, idx) => {
      const ratio = idx / (items.length - 1);
      const newPan = Number((0.85 - ratio * 1.70).toFixed(2));
      return {
        ...s,
        pan: newPan,
        destinationPan: mode === 'fixed' ? newPan : Number((-newPan).toFixed(2))
      };
    }));
  };

  const arrangeStereoPair = () => {
    setSources(items => items.map((s, idx) => {
      const isLeft = idx % 2 === 0;
      const pan = isLeft ? 0.75 : -0.75;
      return {
        ...s,
        pan,
        destinationPan: mode === 'fixed' ? pan : -pan
      };
    }));
  };

  const arrangeCrossSweep = () => {
    setSources(items => items.map((s, idx) => {
      const fromLeft = idx % 2 === 0;
      return {
        ...s,
        pan: fromLeft ? 0.8 : -0.8,
        destinationPan: fromLeft ? -0.8 : 0.8,
        travelTime: 6.0 + (idx % 3) * 2.0
      };
    }));
  };

  const arrangeCenter = () => {
    setSources(items => items.map(s => ({
      ...s,
      pan: 0,
      destinationPan: 0
    })));
  };

  // Convert pan [-1, +1] to backend coordinates (X=1.0, Y=pan*2.0, Z=0.0)
  const payloadSources = sources.map(source => ({
    uploadId: source.upload.id,
    startX: 1.0,
    startY: Number((source.pan * 2.0).toFixed(2)),
    startZ: 0.0,
    destinationX: 1.0,
    destinationY: Number(((mode === 'fixed' ? source.pan : source.destinationPan) * 2.0).toFixed(2)),
    destinationZ: 0.0,
    travelTimeSeconds: mode === 'fixed' ? 1.0 : source.travelTime
  }));

  const renderAudio = async () => {
    if (!sources.length) return setError('Upload at least one MP3 or WAV audio tape first.');
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/audio/renders', {
        method: 'POST',
        body: JSON.stringify({ sources: payloadSources, outputName: 'spatia-scene.mp3' })
      });
      setRender(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async (e) => {
    e.preventDefault();
    if (!sources.length) return setError('Upload at least one audio track before saving.');
    try {
      const project = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: projectForm.title,
          description: projectForm.description,
          published: projectForm.published,
          mode,
          scene: { sources: payloadSources, outputName: 'spatia-scene.mp3' },
          assetNames: Object.fromEntries(sources.map(s => [s.upload.id, s.upload.filename])),
          renderId: render?.status === 'complete' ? render.id : ''
        })
      });
      setProjects(items => [project, ...items]);
      if (project.published) setDiscoverProjects(items => [project, ...items]);
      setProjectModal(false);
      setView('library');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const loadProject = (project) => {
    const loaded = (project.scene?.sources || []).map((source, index) => {
      // Decode Y coordinate back to normalized pan [-1, +1]
      const pan = Math.max(-1, Math.min(1, (source.startY || 0) / 2.0));
      const destPan = Math.max(-1, Math.min(1, (source.destinationY || 0) / 2.0));
      return {
        id: crypto.randomUUID(),
        upload: { id: source.uploadId, filename: project.assetNames?.[source.uploadId] || `Track ${index + 1}` },
        pan: Number(pan.toFixed(2)),
        destinationPan: Number(destPan.toFixed(2)),
        travelTime: source.travelTimeSeconds || 8.0
      };
    });
    setSources(loaded);
    setSelectedId(loaded[0]?.id || null);
    setMode(project.mode || 'fixed');
    setTimelineTime(0);
    setRender(null);
    setView('studio');
    setError('');
  };

  const togglePublish = async (project) => {
    try {
      const updated = await api(`/api/projects/${project.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ published: !project.published })
      });
      setProjects(items => items.map(p => p.id === updated.id ? updated : p));
      setDiscoverProjects(items => updated.published
        ? [updated, ...items.filter(p => p.id !== updated.id)]
        : items.filter(p => p.id !== updated.id)
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const followArtist = async (artist) => {
    try {
      const updated = await api(`/api/artists/${artist.id}/follow`, {
        method: artist.followed ? 'DELETE' : 'POST'
      });
      setArtists(items => items.map(a => a.id === updated.id ? updated : a));
    } catch (err) {
      setError(err.message);
    }
  };

  const downloadRender = async () => {
    try {
      await download(render.downloadUrl, render.filename);
    } catch (err) {
      setError(err.message);
    }
  };

  // Studio View JSX
  const studioView = (
    <div className="workspace-shell">
      {/* Sidebar Controls */}
      <aside className="studio-sidebar">
        <div className="sidebar-section">
          <span className="eyebrow">EARPHONE WORKBENCH</span>
          <div className="sidebar-section-title">
            <span>COMPOSITION MODE</span>
            <span className="stamp-badge">L/R EARPHONES</span>
          </div>
          <div className="mode-toggle-group">
            <button
              className={mode === 'fixed' ? 'active' : ''}
              onClick={() => selectMode('fixed')}
            >
              <strong>● Fixed Position</strong>
              <small>Stationary L/R Balance</small>
            </button>
            <button
              className={mode === 'animated' ? 'active' : ''}
              onClick={() => selectMode('animated')}
            >
              <strong>◌ Animated Sweep</strong>
              <small>Travel Across Ears</small>
            </button>
          </div>
        </div>

        {/* Upload Audio Tape Box */}
        <div className="sidebar-section">
          <label className="upload-tape-box">
            <input type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={chooseFiles} />
            <span className="tape-icon">📼</span>
            <strong>{sources.length ? 'Insert Another Track' : 'Load Audio Tape'}</strong>
            <small>MP3 or WAV Linear PCM · Up to 16 tracks</small>
          </label>
        </div>

        {/* Source Track List */}
        {sources.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              <span>LOADED TRACKS ({sources.length})</span>
              <small>Click to Inspect</small>
            </div>
            <div className="source-track-list">
              {sources.map((s, index) => (
                <div
                  key={s.id}
                  className={`track-cassette-item ${s.id === selectedId ? 'selected' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className="track-info">
                    <span className="track-num-stamp">{String(index + 1).padStart(2, '0')}</span>
                    <div className="track-labels">
                      <span className="track-name">{s.upload.filename}</span>
                      <span className="track-sub">
                        {mode === 'animated'
                          ? `Sweep (${formatPanDescription(s.pan)} → ${formatPanDescription(s.destinationPan)})`
                          : formatPanDescription(s.pan)}
                      </span>
                    </div>
                  </div>
                  <div className="track-card-actions">
                    <button
                      type="button"
                      className="track-duplicate-btn"
                      title="Clone Track to Opposite Ear Coordinate"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateSource(s.id);
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="track-remove-btn"
                      title="Remove Track"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSources(items => items.filter(item => item.id !== s.id));
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Track Parameter Card */}
        {selected && (
          <div className="sidebar-section">
            <div className="source-position-card">
              <div className="card-heading-row">
                <strong>{mode === 'animated' ? 'SWEEP START POSITION' : 'EARPHONE POSITION'}</strong>
                <span className="stamp-badge red">STEREO PAN</span>
              </div>

              <div className="earphone-pan-slider-group">
                <div className="pan-scale-labels">
                  <span>◀ 100% LEFT</span>
                  <span>CENTER (0.0)</span>
                  <span>100% RIGHT ▶</span>
                </div>
                <input
                  type="range"
                  min="-1.0"
                  max="1.0"
                  step="0.05"
                  value={selected.pan}
                  onChange={(e) => updateSource(selected.id, { pan: Number(e.target.value) })}
                />
                <div className="pan-readout-pill">
                  {formatPanDescription(selected.pan)}
                </div>
                <div className="preset-button-row">
                  <button onClick={() => updateSource(selected.id, { pan: 1.0 })}>Max L</button>
                  <button onClick={() => updateSource(selected.id, { pan: 0.5 })}>Mid L</button>
                  <button onClick={() => updateSource(selected.id, { pan: 0.0 })}>Center</button>
                  <button onClick={() => updateSource(selected.id, { pan: -0.5 })}>Mid R</button>
                  <button onClick={() => updateSource(selected.id, { pan: -1.0 })}>Max R</button>
                </div>
              </div>

              {mode === 'animated' && (
                <>
                  <div className="card-heading-row" style={{ marginTop: '8px' }}>
                    <strong>SWEEP DESTINATION POSITION</strong>
                    <span className="stamp-badge blue">END POINT</span>
                  </div>
                  <div className="earphone-pan-slider-group">
                    <input
                      type="range"
                      min="-1.0"
                      max="1.0"
                      step="0.05"
                      value={selected.destinationPan}
                      onChange={(e) => updateSource(selected.id, { destinationPan: Number(e.target.value) })}
                    />
                    <div className="pan-readout-pill">
                      {formatPanDescription(selected.destinationPan)}
                    </div>
                  </div>
                  <div className="time-input-row">
                    <span>Travel Duration:</span>
                    <span>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={selected.travelTime}
                        onChange={(e) => updateSource(selected.id, { travelTime: Number(e.target.value) })}
                      /> sec
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="sidebar-section" style={{ marginTop: 'auto' }}>
          <button
            className="primary"
            style={{ width: '100%', padding: '12px', fontSize: '13px' }}
            onClick={renderAudio}
            disabled={busy || isRendering}
          >
            {busy ? 'Preparing DSP Core…' : isRendering ? 'Processing Linear PCM…' : 'Render Binaural Audio →'}
          </button>
          <button
            className="secondary-button"
            style={{ width: '100%', marginTop: '6px' }}
            onClick={() => setProjectModal(true)}
            disabled={!sources.length}
          >
            Save Sketch to Library ＋
          </button>
        </div>

        {error && <div className="render-telegram-slip failed">ERROR: {error}</div>}

        {/* Render Telegram Slip */}
        {render && (
          <div className={`render-telegram-slip ${render.status === 'complete' ? 'complete' : ''}`}>
            <strong>STATUS: {render.status.toUpperCase()}</strong>
            <span>{render.message}</span>
            {render.status === 'complete' && (
              <button className="download-master-btn" onClick={downloadRender}>
                Download Master MP3 ({render.filename}) ↓
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main Soundstage & Timeline */}
      <main className="studio-main-stage">
        <EarphoneSoundstage
          sources={sources}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          updateSource={updateSource}
          mode={mode}
          timelineTime={timelineTime}
          duplicateSource={duplicateSource}
          arrangeSpread={arrangeSpread}
          arrangeStereoPair={arrangeStereoPair}
          arrangeCrossSweep={arrangeCrossSweep}
          arrangeCenter={arrangeCenter}
          setSources={setSources}
        />
        <TapeDeckTimeline
          sources={sources}
          mode={mode}
          time={timelineTime}
          setTime={setTimelineTime}
        />
      </main>
    </div>
  );

  // Library View JSX
  const libraryView = (
    <div className="page-container">
      <div className="page-header-row">
        <div>
          <span className="eyebrow">ARCHIVAL STORAGE</span>
          <h1>Your Binaural Library</h1>
          <p>Handcrafted earphone sketches stored in local memory.</p>
        </div>
        <button className="primary" onClick={() => { setView('studio'); setSources([]); setRender(null); }}>
          ＋ New Sketch
        </button>
      </div>

      <div className="stat-strip-catalog">
        <div className="stat-cell">
          <strong>{projects.length}</strong>
          <span>SAVED SKETCHES</span>
        </div>
        <div className="stat-cell">
          <strong>{projects.filter(p => p.published).length}</strong>
          <span>PUBLISHED</span>
        </div>
        <div className="stat-cell">
          <strong>{sources.length}</strong>
          <span>ACTIVE TRACKS</span>
        </div>
      </div>

      <div className="card-catalog-grid">
        {projects.length ? (
          projects.map(p => (
            <CatalogCard
              key={p.id}
              project={p}
              onLoad={loadProject}
              onPublish={togglePublish}
              onAudio={(proj) => download(`/api/projects/${proj.id}/audio`, `${proj.title}.mp3`).catch(err => setError(err.message))}
            />
          ))
        ) : (
          <div className="render-telegram-slip" style={{ gridColumn: '1 / -1', padding: '32px', textAlign: 'center' }}>
            <strong>NO SAVED SKETCHES YET</strong>
            <p>Compose an audio scene in the studio and save it here to keep your collection.</p>
            <button className="primary" style={{ justifySelf: 'center', marginTop: '10px' }} onClick={() => setView('studio')}>
              Enter Studio →
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Community View JSX
  const communityView = (
    <div className="page-container">
      <div className="page-header-row">
        <div>
          <span className="eyebrow">PUBLIC DISCOVERY</span>
          <h1>Audio Artist Community</h1>
          <p>Listen to published binaural sketches and connect with other sound designers.</p>
        </div>
        <div className="stamp-badge green">EARLY CREATOR NETWORK</div>
      </div>

      <div className="community-columns">
        <section>
          <div className="search-box-row">
            <span>⌕</span>
            <input
              placeholder="Search published sketches or artists..."
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
          </div>
          <div className="card-catalog-grid">
            {discoverProjects.length ? (
              discoverProjects.map(p => (
                <CatalogCard
                  key={p.id}
                  project={p}
                  onLoad={loadProject}
                  onAudio={(proj) => download(`/api/projects/${proj.id}/audio`, `${proj.title}.mp3`).catch(err => setError(err.message))}
                />
              ))
            ) : (
              <div className="render-telegram-slip" style={{ gridColumn: '1 / -1', padding: '24px' }}>
                No published sketches found matching your search.
              </div>
            )}
          </div>
        </section>

        <aside>
          <div className="sidebar-section-title" style={{ marginBottom: '14px' }}>
            <span>ARTIST DIRECTORY</span>
          </div>
          <div className="search-box-row" style={{ marginBottom: '14px' }}>
            <span>⌕</span>
            <input
              placeholder="Filter artists..."
              value={artistSearch}
              onChange={(e) => setArtistSearch(e.target.value)}
            />
          </div>
          <div className="artist-ledger-list">
            {artists.length ? (
              artists.map(artist => (
                <div className="artist-ledger-row" key={artist.id}>
                  <div className="artist-meta-left">
                    <div className="artist-avatar-stamp">
                      {artist.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{artist.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {artist.followers} followers
                      </div>
                    </div>
                  </div>
                  <button
                    className={artist.followed ? 'primary' : ''}
                    onClick={() => followArtist(artist)}
                  >
                    {artist.followed ? 'Following ✓' : 'Follow ＋'}
                  </button>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No artists found.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="studio-header">
        <button className="logo-stamp" onClick={() => setView('studio')}>
          <div className="logo-seal">S8</div>
          <div className="logo-meta">
            <span className="logo-title">SPATIAL8</span>
            <span className="logo-subtitle">Earphone Audio Lab</span>
          </div>
        </button>

        <nav className="main-nav">
          <button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}>
            [1. Studio Workbench]
          </button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
            [2. Archival Library <small>({projects.length})</small>]
          </button>
          <button className={view === 'community' ? 'active' : ''} onClick={() => setView('community')}>
            [3. Community Archive]
          </button>
        </nav>

        <div className="header-user-panel">
          <div className="user-identity">
            <span className="user-badge-initial">{user.name.slice(0, 1).toUpperCase()}</span>
            <span>{user.name}</span>
          </div>
          <button className="signout-button" onClick={logout}>Sign Out</button>
        </div>
      </header>

      {view === 'studio' ? studioView : view === 'library' ? libraryView : communityView}

      {/* Save Project Modal */}
      {projectModal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setProjectModal(false); }}
        >
          <form className="modal-dialog" onSubmit={saveProject}>
            <button type="button" className="modal-close-btn" onClick={() => setProjectModal(false)}>×</button>
            <span className="eyebrow">ARCHIVE ENTRY</span>
            <h2>Save Earphone Sketch</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Your {mode === 'animated' ? 'animated sweep' : 'fixed position'} setup will be filed into your personal library.
            </p>
            <label style={{ display: 'grid', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase' }}>
              Sketch Title
              <input
                value={projectForm.title}
                onChange={(e) => setProjectForm({ ...projectForm, title: e.target.value })}
                required
              />
            </label>
            <label style={{ display: 'grid', gap: '4px', fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase' }}>
              Description
              <textarea
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                placeholder="Notes on the audio source, stereo balance, or performance intent..."
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={projectForm.published}
                onChange={(e) => setProjectForm({ ...projectForm, published: e.target.checked })}
              />
              <span style={{ fontSize: '13px' }}>Publish to the community discovery catalog</span>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setProjectModal(false)}>Cancel</button>
              <button type="submit" className="primary">File into Library →</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: Auth Screen (Logbook Entrance)
// ---------------------------------------------------------------------------

function Auth({ onAuth }) {
  const [signup, setSignup] = useState(false);
  const [form, setForm] = useState({ name: '', email: 'demo@gmail.com', password: 'demo@123' });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await api(`/api/auth/${signup ? 'signup' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(form)
      });
      localStorage.setItem('spatia-token', data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  const useDemo = () => {
    setSignup(false);
    setForm({ name: '', email: 'demo@gmail.com', password: 'demo@123' });
    setError('');
  };

  return (
    <main className="auth-wrapper">
      <div className="auth-seal">
        <span className="stamp-badge red">SPATIAL8 AUDIO LAB</span>
        <span className="stamp-badge">EST. 2026</span>
      </div>

      <span className="eyebrow">LOGBOOK ENTRY</span>
      <h1>Binaural Audio<br /><em>for Stereo Earphones.</em></h1>
      <p className="desc">
        A handcrafted acoustic studio focusing purely on the two fundamental binaural factors:
        Interaural Time Difference (ITD) and Interaural Level Difference (ILD).
      </p>

      <form className="auth-form" onSubmit={submit}>
        {signup && (
          <label>
            Your Name / Artist Handle
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
        )}
        <label>
          Email Address
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </label>
        <label>
          Security Password
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>

        {error && <div className="render-telegram-slip failed">{error}</div>}

        <button type="submit" className="primary" style={{ marginTop: '10px', padding: '12px' }}>
          {signup ? 'Create Lab Account →' : 'Sign In to Workbench →'}
        </button>
      </form>

      {!signup && (
        <div className="demo-fill-card">
          <div>
            <strong>Local Demonstration Account</strong>
            <small>demo@gmail.com / demo@123</small>
          </div>
          <button type="button" onClick={useDemo}>
            Fill Credentials
          </button>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '16px' }}>
        <button
          className="text-button"
          onClick={() => { setSignup(!signup); setError(''); }}
        >
          {signup ? 'Already registered? Sign in to logbook' : 'New sound designer? Register an account'}
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (localStorage.getItem('spatia-token')) {
      api('/api/auth/me').then(setUser).catch(() => localStorage.removeItem('spatia-token'));
    }
  }, []);

  if (!user) return <Auth onAuth={setUser} />;
  return (
    <Studio
      user={user}
      logout={() => {
        localStorage.removeItem('spatia-token');
        setUser(null);
      }}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
