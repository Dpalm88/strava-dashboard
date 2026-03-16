import { useState, useEffect } from "react";
import { getBestEfforts, formatTime, formatDate } from "./stravaApi";

// Ordered display list
const DISTANCE_ORDER = [
  "400m", "1/2 mile", "1k", "1 mile", "2 mile",
  "5k", "10k", "15k", "10 mile", "20k",
  "Half-Marathon", "Marathon",
];

const DISTANCE_LABELS = {
  "400m": "400m",
  "1/2 mile": "½ Mile",
  "1k": "1K",
  "1 mile": "1 Mile",
  "2 mile": "2 Mile",
  "5k": "5K",
  "10k": "10K",
  "15k": "15K",
  "10 mile": "10 Mile",
  "20k": "20K",
  "Half-Marathon": "Half Marathon",
  "Marathon": "Marathon",
};

const MEDAL_COLORS = ["#FC4C02", "#C0A060", "#A0B0C0"]; // orange, gold, silver

export default function PRBoard({ accessToken, activities }) {
  const [bests, setBests] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchProgress, setFetchProgress] = useState(0);

  useEffect(() => {
    if (!accessToken || !activities?.length) return;

    setLoading(true);
    setError(null);

    // We'll fetch details for up to 30 recent runs
    const runs = activities
      .filter(a => a.type === "Run" || a.sport_type === "Run")
      .slice(0, 30);

    setFetchProgress(0);

    // Fetch with progress tracking
    let completed = 0;
    const total = Math.min(runs.length, 30);

    Promise.allSettled(
      runs.map(a =>
        fetch(`https://www.strava.com/api/v3/activities/${a.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
          .then(r => r.json())
          .then(data => {
            completed++;
            setFetchProgress(Math.round((completed / total) * 100));
            return data;
          })
      )
    ).then(results => {
      const targets = [
        "400m", "1/2 mile", "1k", "1 mile", "2 mile",
        "5k", "10k", "15k", "10 mile", "20k",
        "Half-Marathon", "Marathon",
      ];

      const bestsMap = {};
      results.forEach(result => {
        if (result.status !== "fulfilled") return;
        const act = result.value;
        if (!act.best_efforts) return;
        act.best_efforts.forEach(effort => {
          const name = effort.name;
          if (!targets.includes(name)) return;
          if (!bestsMap[name] || effort.elapsed_time < bestsMap[name].elapsed_time) {
            bestsMap[name] = {
              elapsed_time: effort.elapsed_time,
              activity_name: act.name,
              start_date: act.start_date_local,
              activity_id: act.id,
              distance: effort.distance,
            };
          }
        });
      });

      setBests(bestsMap);
      setLoading(false);
    }).catch(err => {
      setError("Failed to load PR data");
      setLoading(false);
    });
  }, [accessToken, activities]);

  const available = DISTANCE_ORDER.filter(d => bests && bests[d]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Personal Records</h2>
        <p style={styles.subtitle}>
          Best efforts from your last {Math.min(activities?.filter(a => a.type === "Run" || a.sport_type === "Run").length, 30)} runs
        </p>
      </div>

      {loading && (
        <div style={styles.loadingBox}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${fetchProgress}%` }} />
          </div>
          <p style={styles.loadingText}>
            Scanning activities for PRs... {fetchProgress}%
          </p>
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}

      {!loading && !error && available.length === 0 && (
        <div style={styles.empty}>
          <span style={styles.emptyIcon}>🏃</span>
          <p>No best efforts found yet. Keep running!</p>
        </div>
      )}

      {!loading && !error && available.length > 0 && (
        <div style={styles.grid}>
          {available.map((dist, idx) => {
            const pr = bests[dist];
            const medalColor = idx < 3 ? MEDAL_COLORS[idx] : "#666";
            return (
              <div key={dist} style={styles.card}>
                <div style={{ ...styles.cardAccent, background: medalColor }} />
                <div style={styles.cardContent}>
                  <div style={styles.distanceLabel}>
                    {idx === 0 && <span style={{ ...styles.badge, background: MEDAL_COLORS[0] }}>FASTEST</span>}
                    <span style={styles.distance}>{DISTANCE_LABELS[dist]}</span>
                  </div>
                  <div style={styles.time}>{formatTime(pr.elapsed_time)}</div>
                  <div style={styles.meta}>
                    <span style={styles.actName}>{pr.activity_name}</span>
                    <span style={styles.date}>{formatDate(pr.start_date)}</span>
                  </div>
                  <a
                    href={`https://www.strava.com/activities/${pr.activity_id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.link}
                  >
                    View on Strava →
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "0 0 2rem",
  },
  header: {
    marginBottom: "1.5rem",
  },
  title: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "2rem",
    fontWeight: 900,
    color: "#F5F5F5",
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  subtitle: {
    color: "#888",
    fontSize: "0.85rem",
    margin: "0.25rem 0 0",
  },
  loadingBox: {
    background: "#1a1a1a",
    borderRadius: "12px",
    padding: "2rem",
    textAlign: "center",
  },
  progressBar: {
    height: "4px",
    background: "#2a2a2a",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "1rem",
  },
  progressFill: {
    height: "100%",
    background: "#FC4C02",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  },
  loadingText: {
    color: "#888",
    fontSize: "0.85rem",
    margin: 0,
  },
  error: {
    color: "#FF6B6B",
    textAlign: "center",
    padding: "2rem",
  },
  empty: {
    textAlign: "center",
    color: "#666",
    padding: "3rem",
  },
  emptyIcon: {
    fontSize: "3rem",
    display: "block",
    marginBottom: "1rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "1rem",
  },
  card: {
    background: "#1a1a1a",
    borderRadius: "12px",
    overflow: "hidden",
    position: "relative",
    border: "1px solid #2a2a2a",
    transition: "border-color 0.2s",
  },
  cardAccent: {
    height: "3px",
    width: "100%",
  },
  cardContent: {
    padding: "1.25rem",
  },
  distanceLabel: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  badge: {
    fontSize: "0.6rem",
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "4px",
    color: "#fff",
    letterSpacing: "0.1em",
    fontFamily: "'Barlow Condensed', sans-serif",
  },
  distance: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  time: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "2.5rem",
    fontWeight: 900,
    color: "#F5F5F5",
    lineHeight: 1,
    marginBottom: "0.75rem",
    letterSpacing: "-0.02em",
  },
  meta: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    marginBottom: "0.75rem",
  },
  actName: {
    color: "#ccc",
    fontSize: "0.85rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  date: {
    color: "#666",
    fontSize: "0.75rem",
  },
  link: {
    color: "#FC4C02",
    fontSize: "0.75rem",
    textDecoration: "none",
    fontWeight: 600,
    letterSpacing: "0.05em",
  },
};
