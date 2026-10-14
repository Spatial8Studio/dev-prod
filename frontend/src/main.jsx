import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import './styles.css';

const api = async (path, options = {}) => {
  const token = localStorage.getItem('spatia-token');
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || 'Request failed');
  return response.status === 204 ? null : response.json();
};

const newSource = upload => ({ id: crypto.randomUUID(), upload, start: [2, 1, .5], destination: [-2, -1, 1], travelTime: 10 });

function Scene({ sources, selectedId, setSelectedId, updateSource }) {
  const mount = useRef(null); const state = useRef({ sources, selectedId });
  useEffect(() => { state.current = { sources, selectedId }; }, [sources, selectedId]);
  useEffect(() => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#10131d');
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 100); camera.position.set(7, 5, 7); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); mount.current.appendChild(renderer.domElement);
    const grid = new THREE.GridHelper(10, 10, '#404b69', '#20263b'); scene.add(grid); scene.add(new THREE.AxesHelper(3));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(.18, 20, 20), new THREE.MeshBasicMaterial({ color: '#f4f5f7' })));
    scene.add(new THREE.HemisphereLight('#b9c7ff', '#10131d', 2));
    const objects = new Map(); let dragging = false; let dragId = null; const ray = new THREE.Raycaster(); const pointer = new THREE.Vector2();
    const redraw = () => {
      for (const [id, mesh] of objects) { if (!state.current.sources.some(source => source.id === id)) { scene.remove(mesh); objects.delete(id); } }
      state.current.sources.forEach(source => {
        let mesh = objects.get(source.id);
        if (!mesh) { mesh = new THREE.Mesh(new THREE.SphereGeometry(.3, 24, 24), new THREE.MeshStandardMaterial({ color: '#f26a5b', emissive: '#7d241d', emissiveIntensity: .5 })); objects.set(source.id, mesh); scene.add(mesh); }
        const active = source.id === state.current.selectedId; mesh.material.color.set(active ? '#f26a5b' : '#d47a70'); mesh.scale.setScalar(active ? 1.2 : 1);
        mesh.position.set(...[source.start[0], source.start[2], source.start[1]]);
      });
    };
    const resize = () => { const { width, height } = mount.current.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }; resize(); addEventListener('resize', resize);
    const point = e => { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; };
    const down = e => { point(e); ray.setFromCamera(pointer, camera); const hit = ray.intersectObjects([...objects.values()])[0]; if (hit) { dragId = [...objects.entries()].find(([, mesh]) => mesh === hit.object)?.[0]; setSelectedId(dragId); dragging = true; renderer.domElement.setPointerCapture(e.pointerId); } };
    const move = e => { if (!dragging || !dragId) return; point(e); ray.setFromCamera(pointer, camera); const hit = ray.intersectObject(grid)[0]; if (!hit) return; const source = state.current.sources.find(item => item.id === dragId); if (!source) return; updateSource(dragId, { start: [Number(hit.point.x.toFixed(1)), Number(hit.point.z.toFixed(1)), source.start[2]] }); };
    const up = e => { dragging = false; dragId = null; renderer.domElement.releasePointerCapture?.(e.pointerId); };
    const wheel = e => { if (!state.current.selectedId) return; const source = state.current.sources.find(item => item.id === state.current.selectedId); if (!source) return; e.preventDefault(); updateSource(source.id, { start: [source.start[0], source.start[1], Number(Math.max(-4, Math.min(4, source.start[2] - e.deltaY * .01)).toFixed(1))] }); };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    let frame; const animate = () => { frame = requestAnimationFrame(animate); redraw(); renderer.render(scene, camera); }; animate();
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', resize); renderer.dispose(); mount.current?.removeChild(renderer.domElement); };
  }, []);
  return <div className="scene" ref={mount}><div className="scene-help">Drag a source on the grid · scroll to change Z · X forward · Y left · Z up</div></div>;
}

function Auth({ onAuth }) {
  const [signup, setSignup] = useState(false); const [form, setForm] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setError(''); try { const data = await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(form) }); localStorage.setItem('spatia-token', data.token); onAuth(data.user); } catch (err) { setError(err.message); } };
  return <main className="auth-shell"><div className="brand-mark">S</div><p className="eyebrow">SPATIA STUDIO</p><h1>Shape sound<br /><em>in three dimensions.</em></h1><p className="muted">Place multiple audio sources around your listener and render one moving binaural scene.</p><form onSubmit={submit}>{signup && <input placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />}<input type="email" placeholder="Email address" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /><input type="password" placeholder="Password (8+ characters)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />{error && <div className="error">{error}</div>}<button className="primary">{signup ? 'Create studio account' : 'Enter your studio'}</button></form><button className="text-button" onClick={() => setSignup(!signup)}>{signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></main>;
}

function Studio({ user, logout }) {
  const [sources, setSources] = useState([]); const [selectedId, setSelectedId] = useState(null); const [render, setRender] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const updateSource = (id, patch) => setSources(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  const choose = async e => { for (const file of [...e.target.files]) { try { const body = new FormData(); body.append('file', file); const upload = await api('/api/audio/uploads', { method: 'POST', body }); const source = newSource(upload); setSources(items => [...items, source]); setSelectedId(source.id); } catch (err) { setError(err.message); } } e.target.value = ''; };
  const renderAudio = async () => { if (!sources.length) return setError('Upload at least one MP3 or WAV first.'); setBusy(true); setError(''); try { setRender(await api('/api/audio/renders', { method: 'POST', body: JSON.stringify({ sources: sources.map(source => ({ uploadId: source.upload.id, startX: source.start[0], startY: source.start[1], startZ: source.start[2], destinationX: source.destination[0], destinationY: source.destination[1], destinationZ: source.destination[2], travelTimeSeconds: source.travelTime })), outputName: 'spatia-scene.mp3' }) })); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const selected = sources.find(source => source.id === selectedId);
  return <div className="app"><header><div className="logo"><span>S</span> SPATIA</div><div className="header-right"><span>Hi, {user.name}</span><button className="ghost" onClick={logout}>Sign out</button></div></header><div className="workspace"><aside><p className="eyebrow">STUDIO / MULTI-SOURCE SCENE</p><h2>Compose your scene</h2><p className="muted small">Drag sources in the 3-D space. Each source can travel between two coordinates before the scene is mixed.</p><label className="upload-card"><input type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={choose} /><span className="upload-icon">↑</span><strong>{sources.length ? 'Add more audio files' : 'Drop audio files'}</strong><small>MP3 or WAV · multiple files supported</small></label><div className="source-list">{sources.map((source, index) => <button className={`source-row ${source.id === selectedId ? 'selected' : ''}`} key={source.id} onClick={() => setSelectedId(source.id)}><span className="source-number">{index + 1}</span><span>{source.upload.filename}</span><span className="remove" onClick={e => { e.stopPropagation(); setSources(items => items.filter(item => item.id !== source.id)); }}>×</span></button>)}</div>{selected && <div className="coordinates"><div className="label-row"><span>SELECTED SOURCE / START</span><span>METRES</span></div>{['X', 'Y', 'Z'].map((axis, i) => <label className="coord" key={axis}><span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span><input type="number" step=".1" value={selected.start[i]} onChange={e => { const next = [...selected.start]; next[i] = Number(e.target.value); updateSource(selected.id, { start: next }); }} /></label>)}<div className="transition-title">TRANSITION DESTINATION</div>{['X', 'Y', 'Z'].map((axis, i) => <label className="coord" key={`dest-${axis}`}><span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span><input type="number" step=".1" value={selected.destination[i]} onChange={e => { const next = [...selected.destination]; next[i] = Number(e.target.value); updateSource(selected.id, { destination: next }); }} /></label>)}<label className="transition-time">Travel time (seconds)<input type="number" min=".1" step=".1" value={selected.travelTime} onChange={e => updateSource(selected.id, { travelTime: Number(e.target.value) })} /></label></div>}<button className="primary render-button" onClick={renderAudio} disabled={busy}>{busy ? 'Mixing spatial scene…' : 'Render and mix scene  →'}</button>{error && <div className="error">{error}</div>}{render && <div className="success"><strong>Scene render complete</strong><span>{render.message}</span><a href={render.downloadUrl}>Download resultant MP3 ↓</a></div>}</aside><section className="viewport"><Scene sources={sources} selectedId={selectedId} setSelectedId={setSelectedId} updateSource={updateSource} /><div className="legend"><span><i className="dot listener" /> Listener</span><span><i className="dot source" /> Audio sources</span></div></section></div></div>;
}

function App() { const [user, setUser] = useState(null); useEffect(() => { if (localStorage.getItem('spatia-token')) api('/api/auth/me').then(setUser).catch(() => localStorage.removeItem('spatia-token')); }, []); if (!user) return <Auth onAuth={setUser} />; return <Studio user={user} logout={() => { localStorage.removeItem('spatia-token'); setUser(null); }} />; }
createRoot(document.getElementById('root')).render(<App />);
