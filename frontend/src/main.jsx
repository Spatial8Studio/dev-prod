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

function Scene({ position, setPosition }) {
  const mount = useRef(null);
  const positionRef = useRef(position);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#10131d');
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100); camera.position.set(7, 5, 7); camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); mount.current.appendChild(renderer.domElement);
    const grid = new THREE.GridHelper(10, 10, '#404b69', '#20263b'); scene.add(grid);
    const axes = new THREE.AxesHelper(3); scene.add(axes);
    const listener = new THREE.Mesh(new THREE.SphereGeometry(.18, 20, 20), new THREE.MeshBasicMaterial({ color: '#f4f5f7' })); scene.add(listener);
    const source = new THREE.Mesh(new THREE.SphereGeometry(.3, 24, 24), new THREE.MeshStandardMaterial({ color: '#f26a5b', emissive: '#7d241d', emissiveIntensity: .5 })); scene.add(source);
    scene.add(new THREE.HemisphereLight('#b9c7ff', '#10131d', 2));
    let dragging = false;
    const resize = () => { const { width, height } = mount.current.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); }; resize(); addEventListener('resize', resize);
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const move = e => { if (!dragging) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; ray.setFromCamera(pointer, camera); const hit = ray.intersectObject(grid)[0]; if (hit) setPosition([Number(hit.point.x.toFixed(1)), Number(hit.point.z.toFixed(1)), positionRef.current[2]]); };
    renderer.domElement.addEventListener('pointerdown', () => { dragging = true; }); renderer.domElement.addEventListener('pointerup', () => { dragging = false; }); renderer.domElement.addEventListener('pointermove', move);
    let frame; const animate = () => { frame = requestAnimationFrame(animate); source.position.set(positionRef.current[0], positionRef.current[2], positionRef.current[1]); renderer.render(scene, camera); }; animate();
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', resize); renderer.dispose(); mount.current?.removeChild(renderer.domElement); };
  }, []);
  return <div className="scene" ref={mount}><div className="scene-help">Drag the coral source on the grid · X forward · Y left · Z up</div></div>;
}

function Auth({ onAuth }) {
  const [signup, setSignup] = useState(false); const [form, setForm] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setError(''); try { const data = await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(form) }); localStorage.setItem('spatia-token', data.token); onAuth(data.user); } catch (err) { setError(err.message); } };
  return <main className="auth-shell"><div className="brand-mark">S</div><p className="eyebrow">SPATIA STUDIO</p><h1>Shape sound<br /><em>in three dimensions.</em></h1><p className="muted">Place an audio source around your listener and render an immersive binaural scene.</p><form onSubmit={submit}>{signup && <input placeholder="Your name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />}<input type="email" placeholder="Email address" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /><input type="password" placeholder="Password (8+ characters)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />{error && <div className="error">{error}</div>}<button className="primary">{signup ? 'Create studio account' : 'Enter your studio'}</button></form><button className="text-button" onClick={() => setSignup(!signup)}>{signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></main>;
}

function Studio({ user, logout }) {
  const [position, setPosition] = useState([2, 1, 0.5]); const [upload, setUpload] = useState(null); const [render, setRender] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const choose = async e => { const file = e.target.files[0]; if (!file) return; setError(''); try { const body = new FormData(); body.append('file', file); setUpload(await api('/api/audio/uploads', { method: 'POST', body })); } catch (err) { setError(err.message); } };
  const renderAudio = async () => { if (!upload) return setError('Upload an MP3 or WAV first.'); setBusy(true); setError(''); try { setRender(await api('/api/audio/renders', { method: 'POST', body: JSON.stringify({ uploadId: upload.id, x: position[0], y: position[1], z: position[2], outputName: `${upload.filename.replace(/\.[^.]+$/, '')}-spatial.mp3` }) })); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  return <div className="app"><header><div className="logo"><span>S</span> SPATIA</div><div className="header-right"><span>Hi, {user.name}</span><button className="ghost" onClick={logout}>Sign out</button></div></header><div className="workspace"><aside><p className="eyebrow">STUDIO / NEW SCENE</p><h2>Position your source</h2><p className="muted small">The listener is at the origin. Move the sound around them to define its spatial perspective.</p><label className="upload-card"><input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={choose} /><span className="upload-icon">↑</span><strong>{upload ? upload.filename : 'Drop an audio file'}</strong><small>{upload ? `${(upload.size / 1024 / 1024).toFixed(2)} MB ready` : 'MP3 or WAV · up to 100 MB'}</small></label><div className="coordinates"><div className="label-row"><span>COORDINATES</span><span>METRES</span></div>{['X', 'Y', 'Z'].map((axis, i) => <label className="coord" key={axis}><span className={`axis axis-${axis.toLowerCase()}`}>{axis}</span><input type="number" step=".1" value={position[i]} onChange={e => { const next = [...position]; next[i] = Number(e.target.value); setPosition(next); }} /></label>)}</div><button className="primary render-button" onClick={renderAudio} disabled={busy}>{busy ? 'Rendering spatial audio…' : 'Render spatial audio  →'}</button>{error && <div className="error">{error}</div>}{render && <div className="success"><strong>Render complete</strong><span>{render.message}</span><a href={render.downloadUrl}>Download MP3 ↓</a></div>}</aside><section className="viewport"><Scene position={position} setPosition={setPosition} /><div className="legend"><span><i className="dot listener" /> Listener</span><span><i className="dot source" /> Audio source</span></div></section></div></div>;
}

function App() {
  const [user, setUser] = useState(null);
  useEffect(() => { if (localStorage.getItem('spatia-token')) api('/api/auth/me').then(setUser).catch(() => localStorage.removeItem('spatia-token')); }, []);
  if (!user) return <Auth onAuth={setUser} />;
  return <Studio user={user} logout={() => { localStorage.removeItem('spatia-token'); setUser(null); }} />;
}
createRoot(document.getElementById('root')).render(<App />);
