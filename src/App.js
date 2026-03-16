import { useState, useEffect } from "react";
import {
  getStravaAuthUrl, exchangeCodeForToken, refreshAccessToken,
  saveTokens, getStoredTokens, clearTokens, isTokenExpired,
  getAthlete, getActivities,
  getWeeklyMileage, getPRs, getTrainingLoad, getRunStats,
  metersToMiles, secondsToPace, formatDuration, metersToFeet,
  getAthleteStats, extractPRs, getCyclingStats, getGear,
  getStarredSegments, getSegmentLeaderboard,
} from "./stravaApi";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
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
    <MapContainer center={center} zoom={12} style={{ height: "320px", borderRadius: "8px" }} zoomControl={false}>
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

// ── Tab Nav ──────────────────────────────────────────────────────────────────
function TabNav({ active, onChange }) {
  const tabs = ["running", "cycling", "segments"];
  const labels = { running: "🏃 Running", cycling: "🚴 Cycling", segments: "🏁 Segments" };
  return (
    <div style={{ display: "flex", gap: "4px", background: "#0d1117", borderRadius: "8px", padding: "4px" }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          padding: "6px 20px", borderRadius: "6px", border: "none", cursor: "pointer",
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.85rem",
          background: active === t ? "#fc4c02" : "transparent",
          color: active === t ? "#fff" : "#6b7a8d",
          transition: "all 0.2s",
        }}>{labels[t]}</button>
      ))}
    </div>
  );
}

// ── PR Board (running tab — uses getPRs from stravaApi) ──────────────────────
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

// ── PRs Tab (uses extractPRs from stravaApi — best_efforts data) ─────────────
function PRsTab({ activities }) {
  const prs = extractPRs(activities);
  const distanceOrder = [
    "400m", "1/2 mile", "1k", "1 mile", "2 mile",
    "5k", "10k", "15k", "10 mile", "20k", "Half-Marathon", "Marathon"
  ];

  function fmt(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  const available = distanceOrder.filter(d => prs[d]);

  if (!available.length) return (
    <div style={{
      background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36",
      color: "#6b7a8d", textAlign: "center", padding: "60px",
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1rem"
    }}>
      No best efforts found. Strava best efforts are recorded automatically during runs.
    </div>
  );

  return (
    <div style={{ background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", overflow: "hidden" }}>
      <div style={{
        padding: "16px 20px", borderBottom: "1px solid #1e2a36",
        fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
        letterSpacing: "0.08em", textTransform: "uppercase",
        color: "#fc4c02", fontSize: "0.85rem"
      }}>
        🏆 Personal Records
      </div>
      {available.map((dist, i) => {
        const pr = prs[dist];
        const date = new Date(pr.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return (
          <div key={dist} style={{
            display: "grid", gridTemplateColumns: "120px 1fr 1fr",
            padding: "12px 20px", alignItems: "center",
            borderBottom: i < available.length - 1 ? "1px solid #1e2a36" : "none",
            background: i % 2 === 0 ? "transparent" : "#080c10",
          }}>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700, color: "#e8edf2", fontSize: "1rem", letterSpacing: "0.04em"
            }}>{dist}</div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: "1.4rem", fontWeight: 700, color: "#fc4c02", letterSpacing: "0.04em"
            }}>{fmt(pr.elapsed_time)}</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.75rem", color: "#6b7a8d" }}>{date}</div>
              <div style={{
                fontSize: "0.7rem", color: "#3d4f61", marginTop: "2px",
                maxWidth: "160px", marginLeft: "auto",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>{pr.activity_name}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Cycling Page ──────────────────────────────────────────────────────────────
function CyclingPage({ activities, gear }) {
  const { rides, totalMiles, totalTime, totalElevation, longestRide, weeks, bikeIds } =
    getCyclingStats(activities);
  const maxMiles = Math.max(...weeks.map(w => w.miles), 1);

  function fmtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const statCards = [
    { label: "Total Rides", value: rides.length },
    { label: "Total Miles", value: totalMiles.toFixed(1) },
    { label: "Moving Time", value: fmtTime(totalTime) },
    { label: "Elevation (ft)", value: Math.round(totalElevation).toLocaleString() },
    { label: "Longest Ride", value: `${parseFloat(longestRide).toFixed(1)} mi` },
    { label: "Bikes", value: bikeIds.length },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
        {statCards.map(c => (
          <div key={c.label} style={{
            background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", padding: "16px 20px"
          }}>
            <div style={{
              fontSize: "0.7rem", color: "#6b7a8d", textTransform: "uppercase",
              letterSpacing: "0.1em", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: "6px"
            }}>{c.label}</div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.8rem",
              fontWeight: 700, color: "#e8edf2", letterSpacing: "0.02em"
            }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Weekly mileage chart */}
      <div style={{ background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", padding: "20px" }}>
        <div style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase",
          color: "#fc4c02", fontSize: "0.85rem", marginBottom: "16px"
        }}>
          🚴 Weekly Ride Mileage
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "120px" }}>
          {weeks.map((w, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", height: "100%" }}>
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                <div style={{
                  width: "100%",
                  height: `${Math.max((w.miles / maxMiles) * 100, w.miles > 0 ? 4 : 0)}%`,
                  background: w.miles === Math.max(...weeks.map(x => x.miles)) ? "#fc4c02" : "#1e3a5f",
                  borderRadius: "3px 3px 0 0", transition: "height 0.3s",
                }} />
              </div>
              <div style={{
                fontSize: "0.55rem", color: "#3d4f61",
                fontFamily: "'Barlow Condensed', sans-serif",
                transform: "rotate(-45deg)", whiteSpace: "nowrap"
              }}>{w.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bike gear */}
      {bikeIds.length > 0 && (
        <div style={{ background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", overflow: "hidden" }}>
          <div style={{
            padding: "16px 20px", borderBottom: "1px solid #1e2a36",
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
            letterSpacing: "0.08em", textTransform: "uppercase", color: "#fc4c02", fontSize: "0.85rem"
          }}>
            🚲 Your Bikes
          </div>
          {bikeIds.map(id => {
            const g = gear[id];
            if (!g) return null;
            const miles = (g.distance / 1609.344).toFixed(0);
            return (
              <div key={id} style={{
                padding: "14px 20px", borderBottom: "1px solid #1e2a36",
                display: "flex", justifyContent: "space-between", alignItems: "center"
              }}>
                <div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: "#e8edf2", fontSize: "1rem" }}>
                    {g.name || "Unnamed Bike"}
                  </div>
                  {g.brand_name && (
                    <div style={{ fontSize: "0.75rem", color: "#6b7a8d", marginTop: "2px" }}>
                      {g.brand_name} {g.model_name}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.4rem", fontWeight: 700, color: "#fc4c02" }}>
                    {parseInt(miles).toLocaleString()} mi
                  </div>
                  <div style={{ fontSize: "0.7rem", color: g.retired ? "#e05" : "#2ecc71", marginTop: "2px" }}>
                    {g.retired ? "Retired" : "Active"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent rides */}
      <div style={{ background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", overflow: "hidden" }}>
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #1e2a36",
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase", color: "#fc4c02", fontSize: "0.85rem"
        }}>
          Recent Rides
        </div>
        {rides.slice(0, 8).map((a, i) => {
          const miles = (a.distance / 1609.344).toFixed(1);
          const date = new Date(a.start_date_local).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const elev = Math.round(a.total_elevation_gain * 3.28084);
          return (
            <div key={a.id} style={{
              padding: "12px 20px", display: "flex",
              justifyContent: "space-between", alignItems: "center",
              borderBottom: i < 7 ? "1px solid #1e2a36" : "none",
              background: i % 2 === 0 ? "transparent" : "#080c10",
            }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, color: "#e8edf2", fontSize: "0.95rem" }}>
                  {a.name}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6b7a8d", marginTop: "2px" }}>
                  {date} · {elev > 0 ? `↑${elev.toLocaleString()} ft` : "flat"}
                </div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "1.2rem", fontWeight: 700, color: "#fc4c02" }}>
                {miles} mi
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ── Segments Tab ──────────────────────────────────────────────────────────────
function SegmentsTab({ segments, activities }) {
  // Build PR map from activity segment efforts
  const segmentPRs = {};
  for (const act of activities) {
    if (!act.segment_efforts) continue;
    for (const effort of act.segment_efforts) {
      const id = effort.segment.id;
      if (!segmentPRs[id]) {
        segmentPRs[id] = { pr: effort.elapsed_time, attempts: 0, prDate: act.start_date_local };
      } else {
        if (effort.elapsed_time < segmentPRs[id].pr) {
          segmentPRs[id].pr = effort.elapsed_time;
          segmentPRs[id].prDate = act.start_date_local;
        }
      }
      segmentPRs[id].attempts += 1;
    }
  }

  function fmtTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  if (!segments.length) return (
    <div style={{
      background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36",
      padding: "60px", textAlign: "center", fontFamily: "'Barlow Condensed', sans-serif"
    }}>
      <div style={{ fontSize: "2rem", marginBottom: "12px" }}>🏁</div>
      <div style={{ color: "#e8edf2", fontSize: "1.2rem", fontWeight: 700, marginBottom: "8px" }}>
        No starred segments found
      </div>
      <div style={{ color: "#6b7a8d", fontSize: "0.9rem" }}>
        Star some segments on Strava and they'll show up here.
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ background: "#0d1117", borderRadius: "12px", border: "1px solid #1e2a36", overflow: "hidden" }}>
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #1e2a36",
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase", color: "#fc4c02", fontSize: "0.85rem"
        }}>
          🏁 Starred Segments
        </div>
        {segments.map((seg, i) => {
          const data = segmentPRs[seg.id];
          return (
            <div key={seg.id} style={{
              padding: "14px 20px",
              borderBottom: i < segments.length - 1 ? "1px solid #1e2a36" : "none",
              background: i % 2 === 0 ? "transparent" : "#080c10",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px",
            }}>
              {/* Left: name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={`https://www.strava.com/segments/${seg.id}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "1rem", color: "#e8edf2", textDecoration: "none" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#fc4c02"}
                  onMouseLeave={e => e.currentTarget.style.color = "#e8edf2"}>
                  {seg.name}
                </a>
                <div style={{ display: "flex", gap: "12px", marginTop: "4px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", color: "#6b7a8d" }}>
                    📍 {(seg.distance / 1609.344).toFixed(2)} mi
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6b7a8d" }}>
                    ↑ {seg.total_elevation_gain ? Math.round(seg.total_elevation_gain * 3.28084) : 0} ft
                  </span>
                  <span style={{
                    fontSize: "0.7rem", color: seg.activity_type === "Run" ? "#4ade80" : "#4a9eff",
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase"
                  }}>
                    {seg.activity_type}
                  </span>
                </div>
              </div>

              {/* Middle: PR + attempts */}
              <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
                {data ? (
                  <>
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        fontSize: "0.65rem", color: "#6b7a8d", textTransform: "uppercase",
                        letterSpacing: "0.1em", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: "2px"
                      }}>
                        Your PR
                      </div>
                      <div style={{
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontSize: "1.3rem", fontWeight: 700, color: "#fc4c02"
                      }}>
                        {fmtTime(data.pr)}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "#3d4f61", marginTop: "2px" }}>
                        {new Date(data.prDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{
                        fontSize: "0.65rem", color: "#6b7a8d", textTransform: "uppercase",
                        letterSpacing: "0.1em", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: "2px"
                      }}>
                        Attempts
                      </div>
                      <div style={{
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontSize: "1.3rem", fontWeight: 700, color: "#e8edf2"
                      }}>
                        {data.attempts}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: "0.75rem", color: "#3d4f61", fontStyle: "italic" }}>
                    Run this segment to see your PR
                  </div>
                )}
              </div>

              {/* Right: View on Strava button */}
              <a href={`https://www.strava.com/segments/${seg.id}`} target="_blank" rel="noopener noreferrer"
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.75rem",
                  fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "#fc4c02", textDecoration: "none",
                  border: "1px solid #fc4c02", padding: "4px 12px", borderRadius: "4px",
                  transition: "all 0.2s", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#fc4c02"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#fc4c02"; }}>
                View on Strava ↗
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ athlete, activities, gear, segments, onLogout }) {
  const [activeTab, setActiveTab] = useState("running");
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
              style={{ width: "40px", height: "40px", borderRadius: "50%", border: "2px solid #fc4c02" }} />
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

        {/* Tab Nav */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "28px" }}>
          <TabNav active={activeTab} onChange={setActiveTab} />
        </div>

        {/* Running Tab */}
        {activeTab === "running" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
              <StatCard label="Total Runs" value={stats.totalRuns} sub="all time" delay={0} />
              <StatCard label="Total Miles" value={stats.totalMiles} sub="all time" delay={80} accent="#4a9eff" />
              <StatCard label="Total Time" value={stats.totalTime} sub="moving time" delay={160} accent="#4ade80" />
              <StatCard label="Longest Run" value={`${stats.longestRun} mi`} sub="single effort" delay={240} accent="#facc15" />
              <StatCard label="Avg Distance" value={`${stats.avgMilesPerRun} mi`} sub="per run" delay={320} accent="#e879f9" />
              <StatCard label="Elevation" value={`${Number(stats.totalElevation).toLocaleString()}ft`} sub="total gain" delay={400} accent="#fb923c" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
              <div>
                <SectionHeader title="Weekly Mileage" sub="Last 12 weeks" />
                <div style={{ background: "#0d1117", border: "1px solid #1e2a36", borderRadius: "8px", padding: "16px" }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weeklyData} barSize={18}>
                      <XAxis dataKey="week" tick={{ fill: "#6b7a8d", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#6b7a8d", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#0d1117", border: "1px solid #1e2a36", borderRadius: "6px", color: "#e8edf2", fontSize: "0.8rem" }}
                        cursor={{ fill: "#1e2a3622" }}
                        formatter={(v) => [`${v} mi`, "Miles"]}
                      />
                      <Bar dataKey="miles" radius={[3, 3, 0, 0]}>
                        {weeklyData.map((entry, i) => (
                          <Cell key={i} fill={entry.miles === maxMiles ? "#fc4c02" : "#1e3a5a"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <SectionHeader title="Training Load" sub="Fitness · Fatigue · Form" />
                <TrainingLoadCard load={load} />
              </div>
            </div>
            <div style={{ marginBottom: "20px" }}>
              <SectionHeader title="Recent Routes" sub="Last 10 GPS runs" />
              <RouteMap activities={activities} />
            </div>
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
        )}

        {/* PRs Tab */}
        {activeTab === "prs" && (
          <PRsTab activities={activities} />
        )}

        {/* Cycling Tab */}
        {activeTab === "cycling" && (
          <CyclingPage activities={activities} gear={gear} />
        )}

        {/* Segments Tab */}
        {activeTab === "segments" && (
          <SegmentsTab segments={segments} activities={activities} />
        )}

      </div>
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState("checking");
  const [athlete, setAthlete] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loadMsg, setLoadMsg] = useState("Connecting to Strava...");
  const [gear, setGear] = useState({});
  const [, setAthleteStats] = useState(null);
  const [segments, setSegments] = useState([]);

  async function loadDashboard(accessToken) {
    setLoadMsg("Fetching athlete profile...");
    const ath = await getAthlete(accessToken);
    setAthlete(ath);
    setLoadMsg("Loading activities...");
    const acts = await getActivities(accessToken, 200);
    setActivities(acts);
    setLoadMsg("Loading stats...");
    const stats = await getAthleteStats(accessToken, ath.id);
    setAthleteStats(stats);
    const gearIds = [...new Set(acts.filter(a => a.gear_id).map(a => a.gear_id))];
    const gearResults = await Promise.all(gearIds.map(id => getGear(accessToken, id)));
    const gearMap = {};
    gearResults.forEach(g => { if (g?.id) gearMap[g.id] = g; });
    setGear(gearMap);

    // Load starred segments + leaderboard data
    setLoadMsg("Loading segments...");
    try {
      const starred = await getStarredSegments(accessToken);
      if (starred && starred.length) {
        const withLeaderboard = await Promise.all(
          starred.slice(0, 20).map(async seg => {
            try {
              const lb = await getSegmentLeaderboard(accessToken, seg.id);
              return { ...seg, leaderboard: lb };
            } catch {
              return { ...seg, leaderboard: null };
            }
          })
        );
        setSegments(withLeaderboard);
      }
    } catch {
      setSegments([]);
    }

    setState("dashboard");
  }


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.history.replaceState({}, "", "/");
      setState("loading");
      setLoadMsg("Authenticating with Strava...");
      exchangeCodeForToken(code)
        .then(data => { saveTokens(data); return loadDashboard(data.access_token); })
        .catch(() => setState("login"));
      return;
    }
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
  return <Dashboard athlete={athlete} activities={activities} gear={gear} segments={segments} onLogout={handleLogout} />;
}
