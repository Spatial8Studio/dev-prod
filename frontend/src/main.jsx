import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './styles.css';

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

const newSource = upload => ({
  id: crypto.randomUUID(),
  upload,
  start: [2, 1, 0.5],
  destination: [-2, -1, 1],
  travelTime: 10
});

const displayPosition = (source, mode, time) => {
  if (!source) return null;
  if (mode === 'fixed') return source.start;
  const duration = Math.max(0.1, Number(source.travelTime) || 1);
  const cycleTime = Math.min(duration * 2, Math.max(0, time));
  const amount = cycleTime <= duration ? cycleTime / duration : 1 - ((cycleTime - duration) / duration);
  return source.start.map((value, index) => value * (1 - amount) + source.destination[index] * amount);
};

// Keep the screen's visual left/right intuitive: source +Y is left, so it is
// rendered toward world -Z from this camera. MATLAB still receives +Y=left.
const worldPoint = position => new THREE.Vector3(position[0], position[2], -position[1]);

const spatialDescription = position => {
  if (!position) return 'Select a source to read its position relative to the listener.';
  const [x, y, z] = position;
  const parts = [];
  if (Math.abs(x) > 0.05) parts.push(`${Math.abs(x).toFixed(1)}m ${x >= 0 ? 'front' : 'behind'}`);
  if (Math.abs(y) > 0.05) parts.push(`${Math.abs(y).toFixed(1)}m ${y >= 0 ? 'left' : 'right'}`);
  if (Math.abs(z) > 0.05) parts.push(`${Math.abs(z).toFixed(1)}m ${z >= 0 ? 'above' : 'below'}`);
  return parts.length ? parts.join(' · ') : 'At the listener';
};

function Scene({ sources, selectedId, setSelectedId, updateSource, mode, timelineTime }) {
  const mount = useRef(null);
  const state = useRef({ sources, selectedId, mode, timelineTime });

  useEffect(() => {
    state.current = { sources, selectedId, mode, timelineTime };
  }, [sources, selectedId, mode, timelineTime]);

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d111c');
    scene.fog = new THREE.Fog('#0d111c', 12, 28);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(7, 5.2, 7);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.current.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(12, 12, '#475271', '#222b43');
    scene.add(grid);
    scene.add(new THREE.AxesHelper(3));
    const listener = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 24, 24),
      new THREE.MeshStandardMaterial({ color: '#f4f5f7', emissive: '#6d789a', emissiveIntensity: 0.45 })
    );
    listener.position.y = 0.16;
    listener.castShadow = true;
    scene.add(listener);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.31, 40),
      new THREE.MeshBasicMaterial({ color: '#f4f5f7', transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
    const facingArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0.18, 0),
      0.95,
      '#f4f5f7',
      0.18,
      0.1
    );
    scene.add(facingArrow);
    scene.add(new THREE.HemisphereLight('#c6d0ff', '#111624', 2.2));
    const key = new THREE.DirectionalLight('#f3a49a', 2.2);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    scene.add(key);

    // The listener faces +X. Source +Y is rendered toward world -Z so visual
    // left/right agrees with the coordinate convention used by MATLAB.
    const axisOrigin = new THREE.Vector3(0, 0.04, 0);
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), axisOrigin, 2.2, '#ef746a', 0.24, 0.12));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), axisOrigin, 2.2, '#78bc87', 0.24, 0.12));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), axisOrigin, 2.2, '#7196e5', 0.24, 0.12));

    const objects = new Map();
    const paths = new Map();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let dragId = null;

    const redraw = () => {
      for (const [id, mesh] of objects) {
        if (!state.current.sources.some(source => source.id === id)) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          objects.delete(id);
        }
      }
      for (const [id, line] of paths) {
        if (!state.current.sources.some(source => source.id === id) || state.current.mode !== 'animated') {
          scene.remove(line);
          line.geometry.dispose();
          line.material.dispose();
          paths.delete(id);
        }
      }
      state.current.sources.forEach(source => {
        let mesh = objects.get(source.id);
        if (!mesh) {
          mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 24, 24),
            new THREE.MeshStandardMaterial({ color: '#f26a5b', emissive: '#7d241d', emissiveIntensity: 0.55 })
          );
          mesh.castShadow = true;
          objects.set(source.id, mesh);
          scene.add(mesh);
        }
        const active = source.id === state.current.selectedId;
        const position = displayPosition(source, state.current.mode, state.current.timelineTime);
        mesh.material.color.set(active ? '#ff806f' : '#d46f69');
        mesh.scale.setScalar(active ? 1.2 : 1);
        mesh.position.copy(worldPoint(position));

        if (state.current.mode === 'animated') {
          let line = paths.get(source.id);
          if (!line) {
            line = new THREE.Line(
              new THREE.BufferGeometry(),
              new THREE.LineBasicMaterial({ color: '#f26a5b', transparent: true, opacity: active ? 0.85 : 0.34 })
            );
            paths.set(source.id, line);
            scene.add(line);
          }
          line.material.opacity = active ? 0.85 : 0.34;
          line.geometry.setFromPoints([worldPoint(source.start), worldPoint(source.destination)]);
        }
      });
    };

    const resize = () => {
      const { width, height } = mount.current.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const point = event => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const down = event => {
      point(event);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects([...objects.values()])[0];
      if (!hit) return;
      dragId = [...objects.entries()].find(([, mesh]) => mesh === hit.object)?.[0];
      setSelectedId(dragId);
      dragging = true;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const move = event => {
      if (!dragging || !dragId) return;
      point(event);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObject(grid)[0];
      const source = state.current.sources.find(item => item.id === dragId);
      if (!hit || !source) return;
      updateSource(dragId, {
        start: [Number(hit.point.x.toFixed(1)), Number((-hit.point.z).toFixed(1)), source.start[2]]
      });
    };
    const up = event => {
      dragging = false;
      dragId = null;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    };
    const wheel = event => {
      const source = state.current.sources.find(item => item.id === state.current.selectedId);
      if (!source) return;
      event.preventDefault();
      updateSource(source.id, {
        start: [source.start[0], source.start[1], Number(Math.max(-4, Math.min(4, source.start[2] - event.deltaY * 0.01)).toFixed(1))]
      });
    };

    resize();
    addEventListener('resize', resize);
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    let frame;
    const animate = () => { frame = requestAnimationFrame(animate); redraw(); renderer.render(scene, camera); };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('wheel', wheel);
      renderer.dispose();
      mount.current?.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="scene" ref={mount}>
    <div className="scene-help">White point = your head · arrow = facing direction · drag to place</div>
    <div className="scene-badge">{mode === 'animated' ? 'PATH PREVIEW' : 'FIXED POINT'}</div>
    <div className="listener-direction"><span className="direction-arrow">→</span><div><strong>You face +X</strong><small>front is ahead · back is behind</small></div></div>
    <div className="hearing-point-hud">
      <span className="eyebrow">HEARING POINT</span>
      <strong>Listener / origin</strong>
      <small>[0, 0, 0] · facing +X</small>
      <div className="hearing-description">{spatialDescription(displayPosition(sources.find(source => source.id === selectedId), mode, timelineTime))}</div>
    </div>
    <div className="axis-hud">
      <span><i className="axis-swatch axis-x" /> <b>+X</b> front <em>−X behind</em></span>
      <span><i className="axis-swatch axis-y" /> <b>+Y</b> left <em>−Y right</em></span>
      <span><i className="axis-swatch axis-z" /> <b>+Z</b> above <em>−Z below</em></span>
    </div>
  </div>;
}

function Auth({ onAuth }) {
  const [signup, setSignup] = useState(false);
  const [form, setForm] = useState({ name: '', email: 'demo@gmail.com', password: 'demo@123' });
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    setError('');
    try {
      const data = await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('spatia-token', data.token);
      onAuth(data.user);
    } catch (err) { setError(err.message); }
  };
  const useDemo = () => {
    setSignup(false);
    setForm({ name: '', email: 'demo@gmail.com', password: 'demo@123' });
    setError('');
  };

  return <main className="auth-shell">
    <div className="auth-orbit"><div className="brand-mark">S</div><span /></div>
    <p className="eyebrow">SPATIA STUDIO / AUDIO SPATIALIZER</p>
    <h1>Shape sound<br /><em>in three dimensions.</em></h1>
    <p className="muted">Compose fixed soundscapes, animate moving sources, and publish immersive sketches for other artists to explore.</p>
    <form onSubmit={submit}>
      {signup && <input placeholder="Your name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required />}
      <input type="email" placeholder="Email address" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required />
      <input type="password" placeholder="Password (8+ characters)" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required />
      {error && <div className="error">{error}</div>}
      <button className="primary">{signup ? 'Create studio account' : 'Enter your studio'} <span>→</span></button>
    </form>
    {!signup && <button className="demo-login" onClick={useDemo}>Use local demo account <span>demo@gmail.com</span></button>}
    <button className="text-button" onClick={() => { setSignup(!signup); setError(''); }}>
      {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
    </button>
  </main>;
}

function Timeline({ sources, mode, time, setTime }) {
  const duration = Math.max(1, ...sources.map(source => Number(source.travelTime) || 1));
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || mode === 'fixed') return undefined;
    let frame;
    let last = performance.now();
    const tick = now => {
      const delta = (now - last) / 1000;
      last = now;
      setTime(value => {
        const next = value + delta;
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

  return <section className={`timeline-panel ${mode === 'fixed' ? 'timeline-fixed' : ''}`}>
    <div className="timeline-heading">
      <div><span className="eyebrow">TIMELINE PREVIEW</span><strong>{mode === 'fixed' ? 'Static listening point' : 'Move through the scene'}</strong></div>
      <span className="time-readout">{time.toFixed(1)}s / {duration.toFixed(1)}s</span>
    </div>
    <div className="timeline-controls">
      <button className="play-button" disabled={mode === 'fixed' || !sources.length} onClick={() => { if (time >= duration) setTime(0); setPlaying(!playing); }}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input type="range" min="0" max={duration} step="0.1" value={Math.min(time, duration)} disabled={!sources.length} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} />
      <span className="timeline-markers"><i /> start <i /> destination</span>
    </div>
  </section>;
}

function ProjectCard({ project, onLoad, onPublish, onAudio }) {
  return <article className="project-card">
    <div className="project-card-top"><span className={`mode-pill ${project.mode}`}>{project.mode === 'animated' ? 'Animated path' : 'Fixed point'}</span><span className={project.published ? 'public-label' : 'private-label'}>{project.published ? 'Published' : 'Private'}</span></div>
    <h3>{project.title}</h3>
    <p>{project.description || 'A spatial audio sketch with no description yet.'}</p>
    <div className="project-meta"><span>by {project.owner?.name || 'Unknown artist'}</span><span>{new Date(project.updatedAt).toLocaleDateString()}</span></div>
    <div className="card-actions">
      <button className="small-button" onClick={() => onLoad(project)}>Open in studio</button>
      {onPublish && <button className="small-button subtle" onClick={() => onPublish(project)}>{project.published ? 'Unpublish' : 'Publish'}</button>}
      {project.published && project.renderId && <button className="small-button audio" onClick={() => onAudio(project)}>Download audio ↓</button>}
    </div>
  </article>;
}

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
  const [projectForm, setProjectForm] = useState({ title: 'Untitled spatial sketch', description: '', published: false });
  const selected = sources.find(source => source.id === selectedId);
  const isRendering = render && ['queued', 'processing'].includes(render.status);
  const duration = useMemo(() => Math.max(1, ...sources.map(source => Number(source.travelTime) || 1)), [sources]);

  const updateSource = (id, patch) => setSources(items => items.map(item => {
    if (item.id !== id) return item;
    const updated = { ...item, ...patch };
    if (mode === 'fixed' && patch.start) updated.destination = [...patch.start];
    return updated;
  }));

  const selectMode = nextMode => {
    setMode(nextMode);
    setTimelineTime(0);
    if (nextMode === 'fixed') setSources(items => items.map(item => ({ ...item, destination: [...item.start] })));
  };

  useEffect(() => {
    if (!isRendering) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const next = await api(`/api/audio/renders/${render.id}`);
        if (active) setRender(next);
      } catch (err) { if (active) setError(err.message); }
    };
    poll();
    const timer = setInterval(poll, 1200);
    return () => { active = false; clearInterval(timer); };
  }, [render?.id, render?.status]);

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

  const choose = async event => {
    for (const file of [...event.target.files]) {
      try {
        const body = new FormData();
        body.append('file', file);
        const upload = await api('/api/audio/uploads', { method: 'POST', body });
        const source = newSource(upload);
        if (mode === 'fixed') source.destination = [...source.start];
        setSources(items => [...items, source]);
        setSelectedId(source.id);
        setView('studio');
      } catch (err) { setError(err.message); }
    }
    event.target.value = '';
  };

  const payloadSources = sources.map(source => ({
    uploadId: source.upload.id,
    startX: source.start[0], startY: source.start[1], startZ: source.start[2],
    destinationX: mode === 'fixed' ? source.start[0] : source.destination[0],
    destinationY: mode === 'fixed' ? source.start[1] : source.destination[1],
    destinationZ: mode === 'fixed' ? source.start[2] : source.destination[2],
    travelTimeSeconds: mode === 'fixed' ? 1 : source.travelTime
  }));

  const renderAudio = async () => {
    if (!sources.length) return setError('Upload at least one MP3 or WAV first.');
    setBusy(true);
    setError('');
    try {
      setRender(await api('/api/audio/renders', {
        method: 'POST',
        body: JSON.stringify({ sources: payloadSources, outputName: 'spatia-scene.mp3' })
      }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const saveProject = async event => {
    event.preventDefault();
    if (!sources.length) return setError('Upload at least one audio source before saving.');
    try {
      const project = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: projectForm.title,
          description: projectForm.description,
          published: projectForm.published,
          mode,
          scene: { sources: payloadSources, outputName: 'spatia-scene.mp3' },
          assetNames: Object.fromEntries(sources.map(source => [source.upload.id, source.upload.filename])),
          renderId: render?.status === 'complete' ? render.id : ''
        })
      });
      setProjects(items => [project, ...items]);
      if (project.published) setDiscoverProjects(items => [project, ...items]);
      setProjectModal(false);
      setView('library');
      setError('');
    } catch (err) { setError(err.message); }
  };

  const loadProject = project => {
    const loaded = (project.scene?.sources || []).map((source, index) => ({
      id: crypto.randomUUID(),
      upload: { id: source.uploadId, filename: project.assetNames?.[source.uploadId] || `Source ${index + 1}` },
      start: [source.startX, source.startY, source.startZ],
      destination: [source.destinationX, source.destinationY, source.destinationZ],
      travelTime: source.travelTimeSeconds
    }));
    setSources(loaded);
    setSelectedId(loaded[0]?.id || null);
    setMode(project.mode || 'fixed');
    setTimelineTime(0);
    setRender(null);
    setView('studio');
    setError('');
  };

  const togglePublish = async project => {
    try {
      const updated = await api(`/api/projects/${project.id}/publish`, { method: 'POST', body: JSON.stringify({ published: !project.published }) });
      setProjects(items => items.map(item => item.id === updated.id ? updated : item));
      setDiscoverProjects(items => updated.published ? [updated, ...items.filter(item => item.id !== updated.id)] : items.filter(item => item.id !== updated.id));
    } catch (err) { setError(err.message); }
  };

  const follow = async artist => {
    try {
      const updated = await api(`/api/artists/${artist.id}/follow`, { method: artist.followed ? 'DELETE' : 'POST' });
      setArtists(items => items.map(item => item.id === updated.id ? updated : item));
    } catch (err) { setError(err.message); }
  };

  const downloadRender = async () => {
    try { await download(render.downloadUrl, render.filename); }
    catch (err) { setError(err.message); }
  };

  const renderTitle = render?.status === 'complete' ? 'Scene render complete'
    : render?.status === 'failed' ? 'Render failed'
      : render?.status === 'processing' ? 'Rendering spatial scene' : 'Render queued';

  const studioView = <div className="workspace">
    <aside className="control-panel">
      <div className="panel-kicker"><span className="live-dot" /> WORKSPACE / SCENE BUILDER</div>
      <h2>Compose your scene</h2>
      <p className="muted small">Choose whether a source stays anchored to one point or travels through a path over time.</p>
      <div className="mode-picker">
        <button className={mode === 'fixed' ? 'active' : ''} onClick={() => selectMode('fixed')}><span className="mode-icon">●</span><strong>Fixed point</strong><small>One coordinate</small></button>
        <button className={mode === 'animated' ? 'active' : ''} onClick={() => selectMode('animated')}><span className="mode-icon path-icon">◌</span><strong>Animated path</strong><small>Move over timeline</small></button>
      </div>
      <label className="upload-card">
        <input type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={choose} />
        <span className="upload-icon">↑</span>
        <strong>{sources.length ? 'Add more audio' : 'Drop audio into the scene'}</strong>
        <small>MP3 or WAV · up to 16 sources</small>
      </label>
      <div className="source-list">
        {sources.map((source, index) => <button className={`source-row ${source.id === selectedId ? 'selected' : ''}`} key={source.id} onClick={() => setSelectedId(source.id)}>
          <span className="source-number">{String(index + 1).padStart(2, '0')}</span>
          <span><b>{source.upload.filename}</b><small>{mode === 'animated' ? `${source.travelTime}s movement` : 'Anchored source'}</small></span>
          <span className="remove" onClick={event => { event.stopPropagation(); setSources(items => items.filter(item => item.id !== source.id)); }}>×</span>
        </button>)}
      </div>
      {selected && <div className="coordinates">
        <div className="label-row"><span>{mode === 'animated' ? 'START POSITION' : 'SOURCE POSITION'}</span><span>METRES</span></div>
        {['X', 'Y', 'Z'].map((axis, index) => <label className="coord" key={axis}>
          <span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span>
          <input type="number" step="0.1" value={selected.start[index]} onChange={event => {
            const next = [...selected.start]; next[index] = Number(event.target.value); updateSource(selected.id, { start: next });
          }} />
        </label>)}
        {mode === 'animated' && <>
          <div className="transition-title">PATH DESTINATION</div>
          {['X', 'Y', 'Z'].map((axis, index) => <label className="coord" key={`destination-${axis}`}>
            <span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span>
            <input type="number" step="0.1" value={selected.destination[index]} onChange={event => {
              const next = [...selected.destination]; next[index] = Number(event.target.value); updateSource(selected.id, { destination: next });
            }} />
          </label>)}
          <label className="transition-time">Travel time <span><input type="number" min="0.1" step="0.1" value={selected.travelTime} onChange={event => updateSource(selected.id, { travelTime: Number(event.target.value) })} /> sec</span></label>
        </>}
      </div>}
      <div className="action-stack">
        <button className="primary render-button" onClick={renderAudio} disabled={busy || isRendering}>{busy ? 'Queueing render…' : isRendering ? 'Rendering spatial scene…' : `Render ${mode === 'animated' ? 'animated' : 'fixed'} scene  →`}</button>
        <button className="secondary-button" onClick={() => setProjectModal(true)} disabled={!sources.length}>Save project <span>＋</span></button>
      </div>
      {error && <div className="error">{error}</div>}
      {render && <div className={`render-status ${render.status}`}>
        <strong>{renderTitle}</strong>
        <span>{render.message}</span>
        {render.status === 'complete' && <button className="download-button" onClick={downloadRender}>Download {render.filename} ↓</button>}
      </div>}
    </aside>
    <section className="viewport">
      <Scene sources={sources} selectedId={selectedId} setSelectedId={setSelectedId} updateSource={updateSource} mode={mode} timelineTime={timelineTime} />
      <div className="viewport-topline"><span className="coordinate-note">LISTENER AT ORIGIN / HEADPHONES RECOMMENDED</span><span className="source-count">{sources.length} {sources.length === 1 ? 'SOURCE' : 'SOURCES'}</span></div>
      <div className="legend"><span><i className="dot listener" /> Listener</span><span><i className="dot source" /> Audio source</span>{mode === 'animated' && <span><i className="line-dot" /> Path</span>}</div>
      <Timeline sources={sources} mode={mode} time={timelineTime} setTime={setTimelineTime} />
    </section>
  </div>;

  const libraryView = <main className="page-shell">
    <div className="page-heading"><div><span className="eyebrow">YOUR LIBRARY</span><h1>Projects that are<br /><em>ready to revisit.</em></h1></div><button className="primary heading-action" onClick={() => { setView('studio'); setSources([]); setRender(null); }}>＋ New project</button></div>
    <div className="library-strip"><div><strong>{projects.length}</strong><span>saved projects</span></div><div><strong>{projects.filter(project => project.published).length}</strong><span>published sketches</span></div><div><strong>{sources.length}</strong><span>loaded sources</span></div></div>
    <div className="section-heading"><span>ALL PROJECTS</span><small>Saved in this studio</small></div>
    <div className="project-grid">{projects.length ? projects.map(project => <ProjectCard key={project.id} project={project} onLoad={loadProject} onPublish={togglePublish} onAudio={project => download(`/api/projects/${project.id}/audio`, `${project.title}.mp3`).catch(err => setError(err.message))} />) : <div className="empty-state"><span>✦</span><strong>Your library is quiet.</strong><p>Build a fixed or animated scene, then save it here for later.</p><button className="secondary-button" onClick={() => setView('studio')}>Start composing →</button></div>}</div>
  </main>;

  const communityView = <main className="page-shell community-page">
    <div className="page-heading"><div><span className="eyebrow">THE COMMUNITY</span><h1>Find your next<br /><em>listening reference.</em></h1></div><div className="community-stat"><span className="live-dot" /> EARLY CREATOR NETWORK<br /><b>Discover · follow · remix</b></div></div>
    <div className="community-layout">
      <section className="discover-column"><div className="search-row"><span>⌕</span><input placeholder="Search published projects or artists" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} /></div><div className="section-heading"><span>DISCOVER PROJECTS</span><small>{discoverProjects.length} public sketches</small></div><div className="project-grid">{discoverProjects.length ? discoverProjects.map(project => <ProjectCard key={project.id} project={project} onLoad={loadProject} onAudio={project => download(`/api/projects/${project.id}/audio`, `${project.title}.mp3`).catch(err => setError(err.message))} />) : <div className="empty-state compact"><span>⌁</span><strong>No published sketches yet.</strong><p>Publish a project from your library and it will appear here.</p></div>}</div></section>
      <aside className="artist-column"><div className="section-heading"><span>ARTISTS</span><small>Find collaborators</small></div><div className="search-row small-search"><span>⌕</span><input placeholder="Search artists" value={artistSearch} onChange={event => setArtistSearch(event.target.value)} /></div><div className="artist-list">{artists.length ? artists.map(artist => <div className="artist-row" key={artist.id}><div className="avatar">{artist.name.slice(0, 1).toUpperCase()}</div><div className="artist-copy"><strong>{artist.name}</strong><small>{artist.followers} followers</small></div><button className={artist.followed ? 'follow-button following' : 'follow-button'} onClick={() => follow(artist)}>{artist.followed ? 'Following' : 'Follow'}</button></div>) : <p className="muted small">No other artists yet. Invite a collaborator by sharing the studio.</p>}</div><div className="future-card"><span>✦</span><strong>Personalized discovery is next.</strong><p>Spatia will learn from listening history, spatial gestures, and saved projects to suggest references that fit your practice.</p></div></aside>
    </div>
  </main>;

  return <div className="app">
    <header>
      <button className="logo" onClick={() => setView('studio')}><span>S</span> SPATIA</button>
      <nav className="main-nav"><button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}>Studio</button><button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>Library <small>{projects.length}</small></button><button className={view === 'community' ? 'active' : ''} onClick={() => setView('community')}>Community</button></nav>
      <div className="header-right"><div className="user-chip"><span>{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</div><button className="ghost" onClick={logout}>Sign out</button></div>
    </header>
    {view === 'studio' ? studioView : view === 'library' ? libraryView : communityView}
    {projectModal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProjectModal(false); }}><form className="project-modal" onSubmit={saveProject}><button type="button" className="modal-close" onClick={() => setProjectModal(false)}>×</button><span className="eyebrow">SAVE TO LIBRARY</span><h2>Give this scene a home.</h2><p className="muted small">Your {mode} setup will be saved with its source coordinates. Publish it when you are ready for other artists to discover it.</p><label>Project title<input value={projectForm.title} onChange={event => setProjectForm({ ...projectForm, title: event.target.value })} required /></label><label>Description <span className="optional">optional</span><textarea value={projectForm.description} onChange={event => setProjectForm({ ...projectForm, description: event.target.value })} placeholder="What should someone notice when they listen?" /></label><label className="publish-toggle"><input type="checkbox" checked={projectForm.published} onChange={event => setProjectForm({ ...projectForm, published: event.target.checked })} /><span><strong>Publish to Community</strong><small>Make this project searchable by other artists.</small></span></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setProjectModal(false)}>Cancel</button><button className="primary">Save project →</button></div></form></div>}
  </div>;
}

function App() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    if (localStorage.getItem('spatia-token')) api('/api/auth/me').then(setUser).catch(() => localStorage.removeItem('spatia-token'));
  }, []);
  if (!user) return <Auth onAuth={setUser} />;
  return <Studio user={user} logout={() => { localStorage.removeItem('spatia-token'); setUser(null); }} />;
}

createRoot(document.getElementById('root')).render(<App />);
