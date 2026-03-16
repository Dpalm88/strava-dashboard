import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  getAllGear, getRideStats, getWeeklyRideMileage,
  metersToMiles, metersToFeet, formatDuration, secondsToPace,
} from "./stravaApi";

function StatCard({ label, value, unit }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statValue}>
        {value}
        {unit && <span style={styles.statUnit}>{unit}</span>}
      </div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function GearCard({ gear }) {
  const miles = gear.converted_distance
    ? gear.converted_distance.toFixed(0)
    : metersToMiles(gear.distance || 0);
  const pct = Math.min(100, (parseFloat(miles) / 3000) * 100); // assume 3000mi lifespan

  return (
    <div style={styles.gearCard}>
      <div style={styles.gearHeader}>
        <div>
          <div style={styles.gearName}>{gear.name || "Unnamed Bike"}</div>
          <div style={styles.gearBrand}>{gear.brand_name} {gear.model_name}</div>
        </div>
        <div style={styles.gearMiles}>{miles} <span style={styles.gearMilesUnit}>mi</span></div>
      </div>
      <div style={styles.gearBarBg}>
        <div style={{ ...styles.gearBarFill, width: `${pct}%`, background: pct > 80 ? "#FF6B6B" : "#FC4C02" }} />
      </div>
      <div style={styles.gearBarLabel}>
        {pct > 80 ? "⚠️ High mileage" : `${(3000 - parseFloat(miles)).toFixed(0)} mi remaining (est.)`}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={styles.tooltip}>
      <div style={styles.tooltipLabel}>{label}</div>
      <div style={styles.tooltipValue}>{payload[0].value} mi</div>
    </div>
  );
};

export default function CyclingPage({ accessToken, activities }) {
  const [gear, setGear] = useState({});
  const [gearLoading, setGearLoading] = useState(true);

  const rides = activities.filter(
    a => a.type === "Ride" || a.sport_type === "Ride" || a.sport_type === "VirtualRide"
  );

  const stats = getRideStats(activities);
  const weeklyData = getWeeklyRideMileage(activities, 12);
  const maxMiles = Math.max(...weeklyData.map(w => w.miles), 1);

  useEffect(() => {
    if (!accessToken || !activities?.length) return;
    setGearLoading(true);
    getAllGear(accessToken, activities)
      .then(g => { setGear(g); setGearLoading(false); })
      .catch(() => setGearLoading(false));
  }, [accessToken, activities]);

  const bikeGear = Object.values(gear).filter(g => !g.resource_state || g.frame_type !== undefined || g.athlete_count === undefined);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Cycling</h2>
        <p style={styles.subtitle}>{rides.length} rides in your history</p>
      </div>

      {rides.length === 0 ? (
        <div style={styles.empty}>
          <span style={styles.emptyIcon}>🚴</span>
          <p>No rides found in your recent activities.</p>
          <p style={{ color: "#555", fontSize: "0.85rem" }}>
            Log a ride on Strava and come back!
          </p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={styles.statsGrid}>
            <StatCard label="Total Rides" value={stats.totalRides} />
            <StatCard label="Total Miles" value={stats.totalMiles} unit=" mi" />
            <StatCard label="Moving Time" value={stats.totalTime} />
            <StatCard label="Elevation" value={parseInt(stats.totalElevation).toLocaleString()} unit=" ft" />
            <StatCard label="Longest Ride" value={stats.longestRide} unit=" mi" />
            <StatCard label="Avg Speed" value={stats.avgSpeedMph} unit=" mph" />
            {stats.totalKilojoules > 0 && (
              <StatCard label="Total Energy" value={stats.totalKilojoules.toLocaleString()} unit=" kJ" />
            )}
          </div>

          {/* Weekly mileage chart */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Weekly Mileage (Last 12 Weeks)</h3>
            <div style={styles.chartBox}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weeklyData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <XAxis dataKey="week" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="miles" radius={[4, 4, 0, 0]}>
                    {weeklyData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.miles === maxMiles ? "#FC4C02" : "#2a2a2a"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gear */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Your Bikes</h3>
            {gearLoading ? (
              <p style={{ color: "#666", fontSize: "0.85rem" }}>Loading gear...</p>
            ) : bikeGear.length === 0 ? (
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                No gear found. Add your bike in Strava settings!
              </p>
            ) : (
              <div style={styles.gearGrid}>
                {bikeGear.map(g => <GearCard key={g.id} gear={g} />)}
              </div>
            )}
          </div>

          {/* Recent rides */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Recent Rides</h3>
            <div style={styles.rideList}>
              {rides.slice(0, 10).map(ride => {
                const miles = parseFloat(metersToMiles(ride.distance)).toFixed(1);
                const elev = parseInt(metersToFeet(ride.total_elevation_gain || 0)).toLocaleString();
                const duration = formatDuration(ride.moving_time);
                const speedMph = ride.average_speed
                  ? (ride.average_speed * 2.23694).toFixed(1)
                  : null;
                const date = new Date(ride.start_date_local).toLocaleDateString("en-US", {
                  month: "short", day: "numeric",
                });
                const isVirtual = ride.sport_type === "VirtualRide";

                return (
                  <a
                    key={ride.id}
                    href={`https://www.strava.com/activities/${ride.id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.rideRow}
                  >
                    <div style={styles.rideLeft}>
                      <span style={styles.rideIcon}>{isVirtual ? "🖥️" : "🚴"}</span>
                      <div>
                        <div style={styles.rideName}>{ride.name}</div>
                        <div style={styles.rideDate}>{date}{isVirtual ? " · Virtual" : ""}</div>
                      </div>
                    </div>
                    <div style={styles.rideRight}>
                      <span style={styles.rideStat}>{miles} mi</span>
                      <span style={styles.rideStat}>{duration}</span>
                      {speedMph && <span style={styles.rideStat}>{speedMph} mph</span>}
                      <span style={styles.rideElev}>↑ {elev} ft</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </>
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
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
    gap: "0.75rem",
    marginBottom: "2rem",
  },
  statCard: {
    background: "#1a1a1a",
    borderRadius: "12px",
    padding: "1rem",
    border: "1px solid #2a2a2a",
  },
  statValue: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "1.8rem",
    fontWeight: 900,
    color: "#F5F5F5",
    lineHeight: 1,
  },
  statUnit: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#888",
  },
  statLabel: {
    color: "#666",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginTop: "0.4rem",
    fontWeight: 600,
  },
  section: {
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: "0 0 1rem",
  },
  chartBox: {
    background: "#1a1a1a",
    borderRadius: "12px",
    padding: "1.5rem 1rem 1rem",
    border: "1px solid #2a2a2a",
  },
  tooltip: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: "8px",
    padding: "8px 12px",
  },
  tooltipLabel: {
    color: "#888",
    fontSize: "0.75rem",
    marginBottom: "2px",
  },
  tooltipValue: {
    color: "#FC4C02",
    fontWeight: 700,
    fontSize: "1rem",
    fontFamily: "'Barlow Condensed', sans-serif",
  },
  gearGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "1rem",
  },
  gearCard: {
    background: "#1a1a1a",
    borderRadius: "12px",
    padding: "1.25rem",
    border: "1px solid #2a2a2a",
  },
  gearHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1rem",
  },
  gearName: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "#F5F5F5",
  },
  gearBrand: {
    color: "#666",
    fontSize: "0.75rem",
    marginTop: "2px",
  },
  gearMiles: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "1.8rem",
    fontWeight: 900,
    color: "#FC4C02",
    lineHeight: 1,
  },
  gearMilesUnit: {
    fontSize: "0.9rem",
    color: "#888",
  },
  gearBarBg: {
    height: "4px",
    background: "#2a2a2a",
    borderRadius: "2px",
    overflow: "hidden",
    marginBottom: "0.5rem",
  },
  gearBarFill: {
    height: "100%",
    borderRadius: "2px",
    transition: "width 0.5s ease",
  },
  gearBarLabel: {
    color: "#666",
    fontSize: "0.75rem",
  },
  rideList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  rideRow: {
    background: "#1a1a1a",
    borderRadius: "10px",
    padding: "0.9rem 1.2rem",
    border: "1px solid #2a2a2a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textDecoration: "none",
    transition: "border-color 0.2s",
    cursor: "pointer",
  },
  rideLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flex: 1,
    minWidth: 0,
  },
  rideIcon: {
    fontSize: "1.25rem",
    flexShrink: 0,
  },
  rideName: {
    color: "#F5F5F5",
    fontSize: "0.9rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "200px",
  },
  rideDate: {
    color: "#666",
    fontSize: "0.75rem",
    marginTop: "2px",
  },
  rideRight: {
    display: "flex",
    gap: "1rem",
    alignItems: "center",
    flexShrink: 0,
  },
  rideStat: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "1rem",
    fontWeight: 600,
    color: "#ccc",
  },
  rideElev: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#666",
  },
};
