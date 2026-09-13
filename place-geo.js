import { formatTownName } from "./place-name.js";

/** Haversine distance in meters. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6378137;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Reverse-geocode cache cells (~100 m). */
export function placeCacheKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Town for a GPS point: exact cell, else the nearest cached place within maxM.
 * GPS jitter across a toFixed(3) boundary must still count as the same town.
 */
export function nearestCachedPlace(cache, lat, lng, maxM = 450) {
  const exact = formatTownName(cache.get(placeCacheKey(lat, lng)));
  if (exact) return exact;
  let best = null;
  let bestD = maxM;
  for (const [key, place] of cache) {
    if (!place) continue;
    const [plat, plng] = key.split(",").map(Number);
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
    const d = distanceMeters(lat, lng, plat, plng);
    if (d <= bestD) {
      bestD = d;
      best = formatTownName(place);
    }
  }
  return best || null;
}

const US_STATE_ABBREV = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
  "washington, d.c.": "DC",
  "washington dc": "DC",
};

export function regionCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const iso = s.includes("-") ? s.split("-").pop() : "";
  if (iso && /^[A-Za-z]{2}$/.test(iso)) return iso.toUpperCase();
  return US_STATE_ABBREV[s.toLowerCase()] || s;
}

export function photonReverseUrl(lat, lng) {
  return `https://photon.komoot.io/reverse?lon=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`;
}

export function townFromPhoton(data) {
  const p = data?.features?.[0]?.properties;
  if (!p || typeof p !== "object") return "";
  return placeLabelFromPhotonProps(p);
}

/** City + state (US/CA) or city + country elsewhere — e.g. Westfield, NJ / Paris, France. */
export function placeLabelFromPhotonProps(p) {
  if (!p || typeof p !== "object") return "";
  const city = formatTownName(
    p.city || p.town || p.village || p.municipality || p.district || ""
  );
  if (!city) return "";
  const stateCode = regionCode(p.statecode || p.state);
  const countrycode = String(p.countrycode || "").toUpperCase();
  const country = String(p.country || "").trim();
  if (countrycode === "US" || countrycode === "CA") {
    return formatTownName(stateCode ? `${city}, ${stateCode}` : city);
  }
  if (country) return formatTownName(`${city}, ${country}`);
  if (stateCode) return formatTownName(`${city}, ${stateCode}`);
  return city;
}

export function townFromBigDataCloud(data) {
  if (!data || typeof data !== "object") return "";
  const city = formatTownName(data.city || data.locality || "");
  const stateCode =
    regionCode(data.principalSubdivisionCode) || data.principalSubdivision || "";
  const country = data.countryName || "";
  const countryCode = String(data.countryCode || "").toUpperCase();
  if (city && stateCode && (countryCode === "US" || countryCode === "CA")) {
    return formatTownName(`${city}, ${stateCode}`);
  }
  if (city && country && countryCode && countryCode !== "US" && countryCode !== "CA") {
    return formatTownName(`${city}, ${country}`);
  }
  return formatTownName(
    city && stateCode ? `${city}, ${stateCode}` : city || stateCode
  );
}

export function townFromNominatim(data) {
  if (!data || typeof data !== "object") return "";
  const a = data.address || {};
  const city = formatTownName(
    a.city || a.town || a.village || a.hamlet || a.municipality || ""
  );
  const stateCode = regionCode(a["ISO3166-2-lvl4"]) || a.state || "";
  const country = a.country || "";
  const countryCode = String(a.country_code || "").toUpperCase();
  if (city && stateCode && (countryCode === "US" || countryCode === "CA")) {
    return formatTownName(`${city}, ${stateCode}`);
  }
  if (city && country && countryCode && countryCode !== "US" && countryCode !== "CA") {
    return formatTownName(`${city}, ${country}`);
  }
  return formatTownName(
    city && stateCode ? `${city}, ${stateCode}` : city || stateCode
  );
}

async function fetchJson(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function photonSearchUrl(query, limit = 7) {
  const q = String(query || "").trim();
  return `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(
    limit
  )}&lang=en`;
}

/**
 * Forward-geocode place typeahead (city/state/country).
 * Returns [{ label, lat, lng }].
 */
export async function searchPlaces(query, limit = 7) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  const data = await fetchJson(photonSearchUrl(q, limit));
  return placesFromPhotonSearch(data);
}

export function placesFromPhotonSearch(data) {
  const out = [];
  const seen = new Set();
  for (const f of data?.features || []) {
    const p = f?.properties;
    const coords = f?.geometry?.coordinates;
    if (!p || !Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = placeLabelFromPhotonProps(p);
    if (!label) continue;
    const key = `${label}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, lat, lng });
  }
  return out;
}

/**
 * Photon first (CORS * from GitHub Pages / Safari), then BigDataCloud,
 * then Nominatim. Photon and BigDataCloud run in parallel.
 */
export async function fetchTownName(lat, lng) {
  const [photon, bdc] = await Promise.all([
    fetchJson(photonReverseUrl(lat, lng)),
    fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    ),
  ]);
  const named =
    townFromPhoton(photon) || townFromBigDataCloud(bdc);
  if (named) return named;
  const nom = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`
  );
  return townFromNominatim(nom) || "";
}
