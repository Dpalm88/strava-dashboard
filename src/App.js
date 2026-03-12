import { useState, useEffect } from "react";
import {
  getStravaAuthUrl, exchangeCodeForToken, refreshAccessToken,
  saveTokens, getStoredTokens, clearTokens, isTokenExpired,
  getAthlete, getActivities,
  getWeeklyMileage, getPRs, getTrainingLoad, getRunStats,
  metersToMiles, secondsToPace, formatDuration, metersToFeet,
} from "./stravaApi";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Map import (dynamic to avoid SSR issues) ────────────────────────────────
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
delete L.Icon.Default.prototype._getIconUrl;

// ── Fonts via Google ─────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// ── Decode Strava polyline ───────────────────────────────────────────────────
function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// ── CSS variables & global styles ───────────────────────────────────────────
const globalStyle = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #080c10; color: #e8edf2; font-family: 'Barlow', sans-serif; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0d1117; }
  ::-webkit-scrollbar-thumb { background: #fc4c02; border-radius: 3px; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  .card { animation: fadeUp 0.5s ease both; }
`;

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, delay = 0, accent = "#fc4c02" }) {
  return (
    <div className="card" style={{
      background: "linear-gradient(135deg, #0d1117 0%, #111820 100%)",
      border: "1px solid #1e2a36",
      borderTop: `3px solid ${accent}`,
      borderRadius: "8px",
      padding: "20px",
      animationDelay: `${delay}ms`,
    }}>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.75rem",
        letterSpacing: "0.15em", color: "#6b7a8d", textTransform: "uppercase", marginBottom: "8px"
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: "2.2rem",
        fontWeight: 900, color: "#e8edf2", lineHeight: 1, letterSpacing: "-0.02em"
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "0.8rem", color: "#6b7a8d", marginTop: "4px" }}>{sub}</div>}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <h2 style={{
        fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.4rem",
        fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#e8edf2"
      }}>
        {title}
      </h2>
      {sub && <p style={{ fontSize: "0.8rem", color: "#6b7a8d", marginTop: "2px" }}>{sub}</p>}
    </div>
  );
}

// ── PR Board ─────────────────────────────────────────────────────────────────
function PRBoard({ prs }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      {Object.entries(prs).map(([name, data], i) => (
        <div key={name} className="card" style={{
          background: "#0d1117", border: "1px solid #1e2a36",
          borderRadius: "8px", padding: "16px",
          animationDelay: `${i * 100}ms`,
        }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.7rem",
            letterSpacing: "0.15em", color: "#fc4c02", textTransform: "uppercase", marginBottom: "6px"
          }}>
            {name}
          </div>
          {data.best ? (
            <>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.8rem",
                fontWeight: 900, color: "#e8edf2"
              }}>
                {formatDuration(data.best.time)}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#6b7a8d", marginTop: "4px" }}>
                {new Date(data.best.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>
            </>
          ) : (
            <div style={{ fontSize: "0.9rem", color: "#3a4a5a", fontStyle: "italic" }}>No race found</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Training Load Gauge ──────────────────────────────────────────────────────
function TrainingLoadCard({ load }) {
  return (
    <div className="card" style={{
      background: "#0d1117", border: "1px solid #1e2a36",
      borderRadius: "8px", padding: "20px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.7rem",
            letterSpacing: "0.15em", color: "#6b7a8d", textTransform: "uppercase"
          }}>
            Training Status
          </div>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.8rem",
            fontWeight: 900, color: load.statusColor
          }}>
            {load.status}
          </div>
        </div>
        <div style={{
          width: "64px", height: "64px", borderRadius: "50%",
          border: `4px solid ${load.statusColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 20px ${load.statusColor}44`,
        }}>
          <span style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: "1.1rem", fontWeight: 900, color: load.statusColor
          }}>
            {load.tsb > 0 ? "+" : ""}{load.tsb}
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {[
          { label: "Fitness (CTL)", value: load.ctl, color: "#4a9eff" },
          { label: "Fatigue (ATL)", value: load.atl, color: "#fb923c" },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: "0.72rem", color: "#6b7a8d", marginBottom: "4px" }}>{label}</div>
            <div style={{ height: "6px", background: "#1e2a36", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${Math.min(value, 100)}%`,
                background: color, borderRadius: "3px",
                transition: "width 1s ease",
              }} />
            </div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: "1rem", fontWeight: 700, color, marginTop: "2px"
            }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Route Map ────────────────────────────────────────────────────────────────
function RouteMap({ activities }) {
  const recentWithMap = activities
    .filter(a => a.type === "Run" && a.map?.summary_polyline)
    .slice(0, 10);

  if (!recentWithMap.length) return (
    <div style={{
      height: "300px", background: "#0d1117", borderRadius: "8px",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#3a4a5a", fontStyle: "italic", border: "1px solid #1e2a36"
    }}>
      No GPS routes found
    </div>
  );

  const allCoords = recentWithMap.flatMap(a => decodePolyline(a.map.summary_polyline));
  const lats = allCoords.map(c => c[0]);
  const lngs = allCoords.map(c => c[1]);
  const center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];

  const colors = ["#fc4c02", "#4a9eff", "#4ade80", "#facc15", "#e879f9",
    "#fb923c", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];

  return (
    <MapContainer center={center} zoom={12} style={{ height: "320px", borderRadius: "8px" }}
      zoomControl={false}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
      {recentWithMap.map((a, i) => {
        const coords = decodePolyline(a.map.summary_polyline);
        return coords.length > 0 ? (
          <Polyline key={a.id} positions={coords}
            pathOptions={{ color: colors[i % colors.length], weight: 2.5, opacity: 0.85 }} />
        ) : null;
      })}
    </MapContainer>
  );
}

// ── Recent Activities ────────────────────────────────────────────────────────
function RecentActivities({ activities }) {
  const recent = activities.filter(a => a.type === "Run").slice(0, 8);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {recent.map((a, i) => (
        <div key={a.id} className="card" style={{
          background: "#0d1117", border: "1px solid #1e2a36",
          borderRadius: "6px", padding: "12px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          animationDelay: `${i * 60}ms`,
          transition: "border-color 0.2s",
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#fc4c02"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#1e2a36"}
        >
          <div>
            <div style={{
              fontWeight: 500, fontSize: "0.9rem", color: "#e8edf2",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px"
            }}>
              {a.name}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6b7a8d", marginTop: "2px" }}>
              {new Date(a.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </div>
          </div>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.1rem",
                fontWeight: 700, color: "#fc4c02"
              }}>
                {metersToMiles(a.distance)} mi
              </div>
              <div style={{ fontSize: "0.72rem", color: "#6b7a8d" }}>
                {secondsToPace(a.moving_time, a.distance)}/mi
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: "0.95rem", fontWeight: 600, color: "#4a9eff"
              }}>
                {formatDuration(a.moving_time)}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#6b7a8d" }}>
                {metersToFeet(a.total_elevation_gain)}ft ↑
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Login screen ─────────────────────────────────────────────────────────────
function LoginScreen() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at 60% 0%, #1a0f0844 0%, #080c10 60%)",
    }}>
      <style>{globalStyle}</style>
      <div style={{ textAlign: "center", maxWidth: "420px", padding: "40px 20px" }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.75rem",
          letterSpacing: "0.3em", color: "#fc4c02", textTransform: "uppercase", marginBottom: "16px"
        }}>
          Athlete Dashboard
        </div>
        <h1 style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: "clamp(3rem, 8vw, 5rem)",
          fontWeight: 900, lineHeight: 0.9, letterSpacing: "-0.02em", color: "#e8edf2",
          marginBottom: "24px"
        }}>
          YOUR<br />
          <span style={{ color: "#fc4c02" }}>STRAVA</span><br />
          DATA
        </h1>
        <p style={{ color: "#6b7a8d", fontSize: "0.95rem", lineHeight: 1.6, marginBottom: "32px" }}>
          Connect your Strava account to visualize your training load, PRs, routes, and weekly mileage.
        </p>
        <a href={getStravaAuthUrl()} style={{
          display: "inline-flex", alignItems: "center", gap: "10px",
          background: "#fc4c02", color: "#fff", textDecoration: "none",
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1rem",
          fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "14px 32px", borderRadius: "4px",
          boxShadow: "0 0 30px #fc4c0244",
          transition: "all 0.2s",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "#e54400"; e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#fc4c02"; e.currentTarget.style.transform = "translateY(0)"; }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Connect with Strava
        </a>
      </div>
    </div>
  );
}

// ── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen({ message }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#080c10", flexDirection: "column", gap: "16px"
    }}>
      <style>{globalStyle}</style>
      <div style={{
        width: "48px", height: "48px", border: "3px solid #1e2a36",
        borderTop: "3px solid #fc4c02", borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }} />
      <p style={{
        color: "#6b7a8d", fontFamily: "'Barlow Condensed', sans-serif",
        letterSpacing: "0.1em", textTransform: "uppercase", fontSize: "0.85rem"
      }}>
        {message || "Loading..."}
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
function Dashboard({ athlete, activities, onLogout }) {
  const stats = getRunStats(activities);
  const weeklyData = getWeeklyMileage(activities);
  const prs = getPRs(activities);
  const load = getTrainingLoad(activities);
  const maxMiles = Math.max(...weeklyData.map(w => w.miles), 1);

  return (
    <div style={{ minHeight: "100vh", background: "#080c10" }}>
      <style>{globalStyle}</style>

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, #0d1117 0%, #080c10 100%)",
        borderBottom: "1px solid #1e2a36",
        padding: "16px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {athlete.profile_medium && (
            <img src={athlete.profile_medium} alt={athlete.firstname}
              style={{
                width: "40px", height: "40px", borderRadius: "50%",
                border: "2px solid #fc4c02"
              }} />
          )}
          <div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.2rem",
              fontWeight: 700, letterSpacing: "0.05em", color: "#e8edf2"
            }}>
              {athlete.firstname} {athlete.lastname}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6b7a8d" }}>
              {athlete.city}{athlete.city && athlete.state ? ", " : ""}{athlete.state}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.7rem",
            letterSpacing: "0.2em", color: "#fc4c02", textTransform: "uppercase"
          }}>
            Athlete Dashboard
          </div>
          <button onClick={onLogout} style={{
            background: "transparent", border: "1px solid #1e2a36",
            color: "#6b7a8d", fontSize: "0.75rem", padding: "6px 12px",
            borderRadius: "4px", cursor: "pointer", fontFamily: "'Barlow', sans-serif",
            transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#fc4c02"; e.currentTarget.style.color = "#fc4c02"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e2a36"; e.currentTarget.style.color = "#6b7a8d"; }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 20px" }}>

        {/* Top stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
          <StatCard label="Total Runs" value={stats.totalRuns} sub="all time" delay={0} />
          <StatCard label="Total Miles" value={stats.totalMiles} sub="all time" delay={80} accent="#4a9eff" />
          <StatCard label="Total Time" value={stats.totalTime} sub="moving time" delay={160} accent="#4ade80" />
          <StatCard label="Longest Run" value={`${stats.longestRun} mi`} sub="single effort" delay={240} accent="#facc15" />
          <StatCard label="Avg Distance" value={`${stats.avgMilesPerRun} mi`} sub="per run" delay={320} accent="#e879f9" />
          <StatCard label="Elevation" value={`${Number(stats.totalElevation).toLocaleString()}ft`} sub="total gain" delay={400} accent="#fb923c" />
        </div>

        {/* Two column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>

          {/* Weekly mileage chart */}
          <div>
            <SectionHeader title="Weekly Mileage" sub="Last 12 weeks" />
            <div style={{
              background: "#0d1117", border: "1px solid #1e2a36",
              borderRadius: "8px", padding: "16px"
            }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyData} barSize={18}>
                  <XAxis dataKey="week" tick={{ fill: "#6b7a8d", fontSize: 10 }}
                    axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7a8d", fontSize: 10 }}
                    axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#0d1117", border: "1px solid #1e2a36",
                      borderRadius: "6px", color: "#e8edf2", fontSize: "0.8rem"
                    }}
                    cursor={{ fill: "#1e2a3622" }}
                    formatter={(v) => [`${v} mi`, "Miles"]}
                  />
                  <Bar dataKey="miles" radius={[3, 3, 0, 0]}>
                    {weeklyData.map((entry, i) => (
                      <Cell key={i}
                        fill={entry.miles === maxMiles ? "#fc4c02" : "#1e3a5a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Training load */}
          <div>
            <SectionHeader title="Training Load" sub="Fitness · Fatigue · Form" />
            <TrainingLoadCard load={load} />
          </div>
        </div>

        {/* Route map */}
        <div style={{ marginBottom: "20px" }}>
          <SectionHeader title="Recent Routes" sub="Last 10 GPS runs" />
          <RouteMap activities={activities} />
        </div>

        {/* PRs + Recent activities */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <SectionHeader title="Personal Records" sub="Best times by distance" />
            <PRBoard prs={prs} />
          </div>
          <div>
            <SectionHeader title="Recent Runs" sub="Latest activities" />
            <RecentActivities activities={activities} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState("checking"); // checking | login | loading | dashboard
  const [athlete, setAthlete] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loadMsg, setLoadMsg] = useState("Connecting to Strava...");

  async function loadDashboard(accessToken) {
    setLoadMsg("Fetching athlete profile...");
    const ath = await getAthlete(accessToken);
    setAthlete(ath);
    setLoadMsg("Loading activities...");
    const acts = await getActivities(accessToken, 100);
    setActivities(acts);
    setState("dashboard");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      // OAuth callback
      window.history.replaceState({}, "", "/");
      setState("loading");
      setLoadMsg("Authenticating with Strava...");
      exchangeCodeForToken(code)
        .then(data => { saveTokens(data); return loadDashboard(data.access_token); })
        .catch(() => setState("login"));
      return;
    }

    // Check stored tokens
    const { accessToken, refreshToken, expiresAt } = getStoredTokens();
    if (!accessToken) { setState("login"); return; }

    setState("loading");
    if (isTokenExpired(expiresAt)) {
      refreshAccessToken(refreshToken)
        .then(data => { saveTokens(data); return loadDashboard(data.access_token); })
        .catch(() => { clearTokens(); setState("login"); });
    } else {
      loadDashboard(accessToken).catch(() => { clearTokens(); setState("login"); });
    }
  }, []);

  function handleLogout() {
    clearTokens();
    setState("login");
    setAthlete(null);
    setActivities([]);
  }

  if (state === "checking" || state === "loading") return <LoadingScreen message={loadMsg} />;
  if (state === "login") return <LoginScreen />;
  return <Dashboard athlete={athlete} activities={activities} onLogout={handleLogout} />;
}