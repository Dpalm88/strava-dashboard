const CLIENT_ID = process.env.REACT_APP_STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.REACT_APP_STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.REACT_APP_REDIRECT_URI || "http://localhost:3000/callback";

export function getStravaAuthUrl() {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        approval_prompt: "auto",
        scope: "read,activity:read_all",
    });
    return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(code) {
    const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: "authorization_code" }),
    });
    if (!res.ok) throw new Error("Token exchange failed");
    return res.json();
}

export async function refreshAccessToken(refreshToken) {
    const res = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new Error("Token refresh failed");
    return res.json();
}

async function stravaFetch(endpoint, accessToken) {
    const res = await fetch(`https://www.strava.com/api/v3${endpoint}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
    return res.json();
}

export async function getAthlete(accessToken) { return stravaFetch("/athlete", accessToken); }
export async function getActivities(accessToken, perPage = 100) { return stravaFetch(`/athlete/activities?per_page=${perPage}`, accessToken); }

export function saveTokens(tokenData) {
    localStorage.setItem("strava_access_token", tokenData.access_token);
    localStorage.setItem("strava_refresh_token", tokenData.refresh_token);
    localStorage.setItem("strava_expires_at", tokenData.expires_at);
}

export function getStoredTokens() {
    return {
        accessToken: localStorage.getItem("strava_access_token"),
        refreshToken: localStorage.getItem("strava_refresh_token"),
        expiresAt: parseInt(localStorage.getItem("strava_expires_at") || "0"),
    };
}

export function clearTokens() {
    localStorage.removeItem("strava_access_token");
    localStorage.removeItem("strava_refresh_token");
    localStorage.removeItem("strava_expires_at");
}

export function isTokenExpired(expiresAt) { return Date.now() / 1000 > expiresAt - 300; }

export function metersToMiles(m) { return (m / 1609.344).toFixed(2); }
export function metersToFeet(m) { return (m * 3.28084).toFixed(0); }

export function secondsToPace(seconds, distanceMeters) {
    const miles = distanceMeters / 1609.344;
    const paceSeconds = seconds / miles;
    const mins = Math.floor(paceSeconds / 60);
    const secs = Math.round(paceSeconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
}

export function getWeeklyMileage(activities) {
    const weeks = {};
    activities.filter(a => a.type === "Run").forEach(a => {
        const date = new Date(a.start_date);
        const monday = new Date(date);
        monday.setDate(date.getDate() - date.getDay() + 1);
        const key = monday.toISOString().split("T")[0];
        weeks[key] = (weeks[key] || 0) + a.distance;
    });
    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).slice(-12)
        .map(([week, meters]) => ({
            week: new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            miles: parseFloat(metersToMiles(meters)),
        }));
}

export function getPRs(activities) {
    const runs = activities.filter(a => a.type === "Run");
    const prs = {
        "5K": { dist: 5000, best: null },
        "10K": { dist: 10000, best: null },
        "Half Marathon": { dist: 21097, best: null },
        "Marathon": { dist: 42195, best: null },
    };
    runs.forEach(a => {
        Object.entries(prs).forEach(([name, data]) => {
            const tolerance = data.dist * 0.05;
            if (Math.abs(a.distance - data.dist) < tolerance) {
                if (!data.best || a.elapsed_time < data.best.time) {
                    prs[name].best = { time: a.elapsed_time, date: a.start_date, name: a.name };
                }
            }
        });
    });
    return prs;
}

export function getTrainingLoad(activities) {
    const runs = activities.filter(a => a.type === "Run");
    const now = Date.now();
    const dayMs = 86400000;
    let atl = 0, ctl = 0;
    runs.forEach(a => {
        const age = (now - new Date(a.start_date)) / dayMs;
        const load = (a.distance / 1609.344) * (a.total_elevation_gain * 0.01 + 1);
        if (age <= 7) atl += load;
        if (age <= 42) ctl += load / 6;
    });
    const tsb = Math.round(ctl - atl);
    return {
        atl: Math.round(atl), ctl: Math.round(ctl), tsb,
        status: tsb > 5 ? "Fresh" : tsb > -10 ? "Optimal" : tsb > -25 ? "Tired" : "Overreached",
        statusColor: tsb > 5 ? "#4ade80" : tsb > -10 ? "#facc15" : tsb > -25 ? "#fb923c" : "#f87171",
    };
}

export function getRunStats(activities) {
    const runs = activities.filter(a => a.type === "Run");
    const totalMiles = runs.reduce((s, a) => s + a.distance, 0) / 1609.344;
    const totalTime = runs.reduce((s, a) => s + a.elapsed_time, 0);
    const totalElevation = runs.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
    const longestRun = runs.reduce((max, a) => a.distance > (max?.distance || 0) ? a : max, null);
    return {
        totalRuns: runs.length,
        totalMiles: totalMiles.toFixed(1),
        totalTime: formatDuration(totalTime),
        totalElevation: metersToFeet(totalElevation),
        longestRun: longestRun ? parseFloat(metersToMiles(longestRun.distance)) : 0,
        avgMilesPerRun: runs.length ? (totalMiles / runs.length).toFixed(1) : 0,
    };
}