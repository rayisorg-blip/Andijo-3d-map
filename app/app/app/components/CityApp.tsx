
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import SunCalc from 'suncalc';
import { sb } from '@/lib/supabase';

type Plot = { id: string; owner: string; nickname: string; lat: number; lng: number; cell_x: number; cell_y: number; style: string; wall: string; roof: string; garden: boolean; garage: boolean; lights: boolean; created_at: string };
type Pn = { lat: number; lng: number; cx: number; cy: number; plot?: Plot };
const CENTER: [number, number] = [72.3442, 40.7821], PRICE = 25000;
const WALL_H: Record<string, number> = { modern: 7, classic: 9, villa: 12, uzbek: 5 };
const ROOF_H: Record<string, number> = { modern: 0.6, classic: 3, villa: 2, uzbek: 1.5 };
const EMPTY: any = { type: 'FeatureCollection', features: [] };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: number[]) => `rgb(${c})`;
const sq = (x: number, y: number, s: number) => { const a = 3.5e-5 * s, b = 3e-5 * s; return [[[x - a, y - b], [x + a, y - b], [x + a, y + b], [x - a, y + b], [x - a, y - b]]]; };

const feats = (p: Plot): any[] => {
  const box = (s: number, ox: number, base: number, h: number, color: string) =>
    ({ type: 'Feature', properties: { base, h, color }, geometry: { type: 'Polygon', coordinates: sq(p.lng + ox, p.lat, s) } });
  const h = WALL_H[p.style] ?? 7;
  const f: any[] = [box(1, 0, 0, h, p.wall), box(p.style === 'classic' ? 0.7 : 0.95, 0, h, h + (ROOF_H[p.style] ?? 1), p.roof)];
  if (p.garden) f.unshift(box(1.8, 0, 0, 0.1, '#4f8f3a'));
  if (p.garage) f.push(box(0.5, 6e-5, 0, 3, '#9aa0aa'));
  f.push({ type: 'Feature', properties: { nick: p.nickname, lights: p.lights }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  return f;
};

const Styles = ({ v, on }: { v: string; on: (s: string) => void }) =>
  <div className="row">{Object.keys(WALL_H).map(s => <button key={s} className={v === s ? 'pri' : ''} onClick={() => on(s)}>{s}</button>)}</div>;

export default function CityApp() {
  const box = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null), fx = useRef<HTMLCanvasElement>(null);
  const roads = useRef<string[]>([]), plotsRef = useRef<Plot[]>([]), pick = useRef<(x: number, y: number) => void>(() => {});
  const [ready, setReady] = useState(false), [plots, setPlots] = useState<Plot[]>([]), [user, setUser] = useState<any>(null);
  const [panel, setPanel] = useState<null | 'auth' | 'me' | Pn>(null), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date()), [off, setOff] = useState(0), [wx, setWx] = useState({ kind: 'clear', t: 0 }), [wxo, setWxo] = useState<string | null>(null);
  const [qs, setQs] = useState(''), [nick, setNick] = useState(''), [f, setF] = useState({ style: 'modern', wall: '#e8e2d5', roof: '#8a3b2e' });
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [bal, setBal] = useState<number | null>(null);
  const kind = wxo ?? wx.kind, pn = panel && typeof panel === 'object' ? panel : null;
  const mine = plots.find(p => p.owner === user?.id);

  // ---- sun / sky / weather environment ----
  const env = useMemo(() => {
    const d = new Date(now.getTime() + off * 36e5), p = SunCalc.getPosition(d, CENTER[1], CENTER[0]);
    const alt = p.altitude * 180 / Math.PI, az = (p.azimuth * 180 / Math.PI + 180) % 360;
    const t = clamp((10 - alt) / 26, 0, 1), cl = kind === 'rain' || kind === 'snow' ? 0.6 : kind === 'cloud' ? 0.3 : 0;
    const day = [[90, 150, 230], [190, 215, 245]], dusk = [[70, 60, 120], [250, 140, 90]], night = [[8, 12, 35], [20, 30, 70]], gray = [75, 80, 90];
    const pk = (i: number) => t < 0.4 ? mix(day[i], dusk[i], t / 0.4) : mix(dusk[i], night[i], (t - 0.4) / 0.6);
    const du = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6, n = clamp(-alt / 12, 0, 1);
    return { alt, az, n, cl, ln: clamp((4 - alt) / 8, 0, 1), sky: rgb(mix(pk(0), gray, cl)), hor: rgb(mix(pk(1), gray, cl)),
      lc: rgb(mix([255, 255, 255], [255, 150, 90], du)), li: (0.15 + 0.6 * (1 - n)) * (1 - cl * 0.5), d };
  }, [now, off, kind]);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }).format(env.d);

  useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const go = () => fetch('https://api.open-meteo.com/v1/forecast?latitude=40.7821&longitude=72.3442&current=temperature_2m,weather_code&timezone=Asia%2FTashkent')
      .then(r => r.json()).then(j => {
        const c = j.current.weather_code as number;
        const k = [71, 73, 75, 77, 85, 86].includes(c) ? 'snow' : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95 ? 'rain' : [3, 45, 48].includes(c) ? 'cloud' : 'clear';
        setWx({ kind: k, t: Math.round(j.current.temperature_2m) });
      }).catch(() => {});
    go(); const i = setInterval(go, 6e5); return () => clearInterval(i);
  }, []);

  // ---- map setup ----
  useEffect(() => {
    const m = new maplibregl.Map({ container: box.current!, style: 'https://tiles.openfreemap.org/styles/liberty', center: CENTER, zoom: 13.5, pitch: 55, bearing: -15, maxPitch: 80, maxBounds: [[72.2, 40.68], [72.5, 40.88]] });

    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');
    m.on('load', () => {
      const L: any[] = m.getStyle().layers;
      L.filter(l => l['source-layer'] === 'building' || l['source-layer'] === 'housenumber').forEach(l => m.removeLayer(l.id));
      roads.current = L.filter(l => l.type === 'line' && l['source-layer'] === 'transportation' && /^road_/.test(l.id) && !/casing|rail|path|ferry|tunnel/.test(l.id)).map(l => l.id);
      ['houses', 'sel', 'lights'].forEach(id => m.addSource(id, { type: 'geojson', data: EMPTY }));
      m.addLayer({ id: 'sel', type: 'fill', source: 'sel', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.45 } });
      m.addLayer({ id: 'lights', type: 'circle', source: 'lights', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 19, 26], 'circle-color': '#ffc468', 'circle-blur': 1, 'circle-opacity': 0 } });
      m.addLayer({ id: 'house-glow', type: 'circle', source: 'houses', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'lights'], true]], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 20, 60], 'circle-color': '#ffd27a', 'circle-blur': 1, 'circle-opacity': 0 } });
      m.addLayer({ id: 'houses', type: 'fill-extrusion', source: 'houses', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-vertical-gradient': true } });
      m.addLayer({ id: 'nick', type: 'symbol', source: 'houses', filter: ['==', ['geometry-type'], 'Point'], layout: { 'text-field': ['get', 'nick'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, -3], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-halo-color': '#0b1020', 'text-halo-width': 2 } });
      m.on('click', e => pick.current(e.lngLat.lng, e.lngLat.lat));
      m.on('moveend', () => streetlights(m));
      setReady(true);
    });
    const streetlights = (mm: maplibregl.Map) => {
      if (mm.getZoom() < 15.5 || !roads.current.length) return;
      const out: any[] = [], seen = new Set<string>();
      for (const ft of mm.queryRenderedFeatures({ layers: roads.current })) {
        const g: any = ft.geometry, lines: number[][][] = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const ln of lines) for (let i = 1; i < ln.length; i++) {
          const [x0, y0] = ln[i - 1], [x1, y1] = ln[i], n = Math.max(1, Math.floor(Math.hypot((x1 - x0) * 84300, (y1 - y0) * 111320) / 35));
          for (let k = 0; k < n; k++) {
            const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n, key = x.toFixed(5) + y.toFixed(5);
            if (!seen.has(key) && out.length < 3000) { seen.add(key); out.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } }); }
          }
        }
      }
      (mm.getSource('lights') as any).setData({ type: 'FeatureCollection', features: out });
    };
    return () => m.remove();
  }, []);

  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    (m as any).setSky({ 'sky-color': env.sky, 'horizon-color': env.hor, 'fog-color': env.hor, 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.3 });
    (m as any).setLight({ anchor: 'map', position: [1.5, env.az, clamp(90 - env.alt, 10, 80)], intensity: env.li, color: env.lc });
    m.setPaintProperty('lights', 'circle-opacity', env.ln * 0.9);
    m.setPaintProperty('house-glow', 'circle-opacity', env.ln * 0.8);
  }, [env, ready]);

  useEffect(() => {
    const cv = fx.current!, g = cv.getContext('2d')!; let id = 0;
    const fit = () => { cv.width = innerWidth; cv.height = innerHeight; }; fit(); addEventListener('resize', fit);
    const P = Array.from({ length: kind === 'rain' ? 500 : kind === 'snow' ? 250 : 0 }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, s: Math.random() + 0.5 }));
    const loop = () => {
      g.clearRect(0, 0, cv.width, cv.height); g.strokeStyle = 'rgba(180,200,255,.45)'; g.fillStyle = 'rgba(255,255,255,.85)';
      for (const p of P) {
        g.beginPath();
        if (kind === 'rain') { g.moveTo(p.x, p.y); g.lineTo(p.x - 2, p.y + 14 * p.s); g.stroke(); p.y += 18 * p.s; p.x -= 1.5; }
        else { g.arc(p.x, p.y, 1.5 * p.s, 0, 7); g.fill(); p.y += 1.5 * p.s; p.x += Math.sin(p.y / 40); }
        if (p.y > cv.height) { p.y = -10; p.x = Math.random() * cv.width; }
      }
      id = requestAnimationFrame(loop);
    };
    if (P.length) loop();
    return () => { cancelAnimationFrame(id); removeEventListener('resize', fit); g.clearRect(0, 0, cv.width, cv.height); };
  }, [kind]);

  useEffect(() => {
    sb.from('plots').select('*').then(({ data }) => data && setPlots(data as Plot[]));
    const ch = sb.channel('plots').on('postgres_changes', { event: '*', schema: 'public', table: 'plots' }, (pl: any) => {
      if (pl.eventType === 'DELETE') setPlots(a => a.filter(p => p.id !== pl.old.id));
      else setPlots(a => [...a.filter(p => p.id !== pl.new.id), pl.new]);
    }).subscribe();
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: s } = sb.auth.onAuthStateChange((_e, ses) => setUser(ses?.user ?? null));
    return () => { sb.removeChannel(ch); s.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    plotsRef.current = plots;
    (map.current?.getSource('houses') as any)?.setData({ type: 'FeatureCollection', features: plots.flatMap(feats) });
  }, [plots, ready]);
  useEffect(() => { if (!user) return setBal(null); sb.from('wallets').select('balance').maybeSingle().then(({ data }) => setBal(data ? data.balance : 100000)); }, [user, plots]);

  pick.current = (x, y) => {
    if (y < 40.72 || y > 40.84 || x < 72.27 || x > 72.42) { setMsg('Outside Andijan'); return; }
    const cx = Math.floor(x * 1e4), cy = Math.floor(y * 1e4), plot = plotsRef.current.find(p => p.cell_x === cx && p.cell_y === cy);
    (map.current?.getSource('sel') as any)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[cx / 1e4, cy / 1e4], [(cx + 1) / 1e4, cy / 1e4], [(cx + 1) / 1e4, (cy + 1) / 1e4], [cx / 1e4, (cy + 1) / 1e4], [cx / 1e4, cy / 1e4]]] } });
    setMsg(''); setPanel({ lat: y, lng: x, cx, cy, plot });
  };
  const fly = (x: number, y: number, z = 18.5, bearing = -20) => map.current?.flyTo({ center: [x, y], zoom: z, pitch: 62, bearing, duration: 2200, essential: true });

  const search = async () => {
    const q = qs.trim().toLowerCase(); if (!q) return;
    const hit = plots.find(p => p.nickname.toLowerCase() === q) || plots.find(p => p.nickname.toLowerCase().includes(q));
    if (hit) { fly(hit.lng, hit.lat, 19); pick.current(hit.lng, hit.lat); return; }
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=72.27,40.84,72.42,40.72&q=${encodeURIComponent(q + ' Andijan')}`).then(r => r.json()).catch(() => []);
    if (r[0]) { fly(+r[0].lon, +r[0].lat, 18); pick.current(+r[0].lon, +r[0].lat); } else setMsg('Nothing found in Andijan');
  };
  const buy = async () => {
    if (!user) return setPanel('auth');
    if (!pn) return; setBusy(true); setMsg('');
    const { data, error } = await sb.rpc('purchase_plot', { p_lat: pn.lat, p_lng: pn.lng, p_nick: nick.trim(), p_style: f.style, p_wall: f.wall, p_roof: f.roof });
    setBusy(false); if (error) return setMsg(error.message);
    setPlots(a => [...a.filter(p => p.id !== data.id), data]); setPanel('me'); fly(data.lng, data.lat, 19);
  };
  const save = async (patch: Partial<Plot>) => {
    if (!mine) return; const n = { ...mine, ...patch };
    setPlots(a => a.map(p => p.id === n.id ? n : p));
    const { error } = await sb.rpc('update_house', { p_style: n.style, p_wall: n.wall, p_roof: n.roof, p_garden: n.garden, p_garage: n.garage, p_lights: n.lights });
    if (error) setMsg(error.message);
  };
  const auth = async (up: boolean) => {
    const r = up ? await sb.auth.signUp({ email, password: pw }) : await sb.auth.signInWithPassword({ email, password: pw });
    if (r.error) setMsg(r.error.message); else if (up && !r.data.session) setMsg('Check your email to confirm, then log in.'); else { setMsg(''); setPanel(null); }
  };
  const spin = () => mine && fly(mine.lng, mine.lat, 19.5, (map.current?.getBearing() ?? 0) + 90);
  const icon: Record<string, string> = { clear: '☀️', cloud: '☁️', rain: '🌧️', snow: '❄️' };

  return <>
    <div ref={box} className="map" />
    <div className="tint" style={{ background: `rgba(6,12,45,${env.n * 0.5})` }} />
    <div className="stars" style={{ opacity: env.n * (1 - env.cl) }} /><div className="moon" style={{ opacity: env.n * (1 - env.cl) }} />
    <canvas ref={fx} className="fx" />
    <div className="load" style={{ opacity: ready ? 0 : 1 }}><div><h1>ANDIJON 3D CITY</h1><small>Your city. Your home. Your virtual world.</small></div></div>

    <div className="bar glass">
      <input placeholder="Search street, mahalla, address or nickname…" value={qs} onChange={e => setQs(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
      <button className="chip" title="Tap to preview weather" onClick={() => setWxo(['clear', 'cloud', 'rain', 'snow'][(['clear', 'cloud', 'rain', 'snow'].indexOf(kind) + 1) % 4])}>{icon[kind]} {wx.t}°</button>
      <button className="chip" title="Tap to preview later hours" onClick={() => setOff(o => (o + 3) % 24)}>🕒 {clock}</button>
      <button className="chip" onClick={() => setPanel(user ? 'me' : 'auth')}>{user ? '👤' : 'Log in'}</button>
    </div>

    {pn && <div className="panel glass">
      <h3>{pn.plot ? `🏠 ${pn.plot.nickname}` : 'Available land'}</h3>
      <small>{pn.lat.toFixed(5)}, {pn.lng.toFixed(5)} · plot {pn.cx}:{pn.cy}</small>
      {pn.plot ? <><b className="sold">SOLD</b><small>Style: {pn.plot.style} · since {new Date(pn.plot.created_at).toLocaleDateString()}</small></> : <>
        <b className="free">AVAILABLE</b>
        <input placeholder="Unique nickname (3–20: a-z 0-9 _)" value={nick} onChange={e => setNick(e.target.value)} />
        <Styles v={f.style} on={style => setF({ ...f, style })} />
        <div className="row">Walls <input type="color" value={f.wall} onChange={e => setF({ ...f, wall: e.target.value })} /> Roof <input type="color" value={f.roof} onChange={e => setF({ ...f, roof: e.target.value })} /></div>
        <div>Price: <b>{PRICE.toLocaleString()} AC</b> <small>(virtual coins — no real money)</small></div>
        <button className="pri" disabled={busy || nick.trim().length < 3} onClick={buy}>{user ? 'BUY HOUSE' : 'Log in to buy'}</button></>}
      {msg && <p className="err">{msg}</p>}<button onClick={() => { setPanel(null); setMsg(''); }}>Close</button>
    </div>}

    {panel === 'auth' && <div className="panel glass"><h3>Log in / Sign up</h3>
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="Password (min 6)" type="password" value={pw} onChange={e => setPw(e.target.value)} />
      <div className="row"><button className="pri" onClick={() => auth(false)}>Log in</button><button onClick={() => auth(true)}>Sign up</button></div>
      {msg && <p className="err">{msg}</p>}<button onClick={() => { setPanel(null); setMsg(''); }}>Close</button></div>}

    {panel === 'me' && <div className="panel glass"><h3>👤 {mine?.nickname ?? 'My profile'}</h3>
      <small>{user?.email} · Balance: {bal?.toLocaleString() ?? '…'} AC (virtual)</small>
      {mine ? <>
        <small>Bought {new Date(mine.created_at).toLocaleDateString()} · {mine.lat.toFixed(5)}, {mine.lng.toFixed(5)}</small>
        <div className="row"><button className="pri" onClick={() => fly(mine.lng, mine.lat, 19)}>Find my house</button><button onClick={spin}>Rotate 90°</button></div>
        <Styles v={mine.style} on={style => save({ style })} />
        <div className="row">Walls <input type="color" value={mine.wall} onChange={e => save({ wall: e.target.value })} /> Roof <input type="color" value={mine.roof} onChange={e => save({ roof: e.target.value })} /></div>
        <div className="row">
          <button className={mine.garden ? 'pri' : ''} onClick={() => save({ garden: !mine.garden })}>Garden</button>
          <button className={mine.garage ? 'pri' : ''} onClick={() => save({ garage: !mine.garage })}>Garage</button>
          <button className={mine.lights ? 'pri' : ''} onClick={() => save({ lights: !mine.lights })}>Night lights</button></div>
      </> : <small>You don’t own a house yet. Search your address or tap the flat land where you live, then buy it.</small>}
      {msg && <p className="err">{msg}</p>}
      <div className="row"><button onClick={() => sb.auth.signOut().then(() => setPanel(null))}>Log out</button><button onClick={() => setPanel(null)}>Close</button></div></div>}
  </>;
}
