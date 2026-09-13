import {
  distanceMeters,
  nearestCachedPlace,
  placeCacheKey,
  photonReverseUrl,
  photonSearchUrl,
  placeLabelFromPhotonProps,
  placesFromPhotonSearch,
  regionCode,
  townFromBigDataCloud,
  townFromNominatim,
  townFromPhoton,
} from "../place-geo.js";

const westfield = { lat: 40.6568, lng: -74.3465 };
const key = placeCacheKey(westfield.lat, westfield.lng);

const cache = new Map();
cache.set(key, "Westfield, NJ");

if (nearestCachedPlace(cache, westfield.lat, westfield.lng) !== "Westfield, NJ") {
  throw new Error("exact cell should return the cached town");
}

// Jitter just across a .toFixed(3) rounding boundary (~111 m cell).
const jitterLat = Number((Math.floor(westfield.lat * 1000) / 1000).toFixed(3)) - 0.00001;
const jittered = { lat: jitterLat, lng: westfield.lng };
if (placeCacheKey(jittered.lat, jittered.lng) === key) {
  throw new Error("fixture should cross a cache-cell boundary");
}

const fromJitter = nearestCachedPlace(cache, jittered.lat, jittered.lng);
if (fromJitter !== "Westfield, NJ") {
  throw new Error(
    `GPS jitter across ${key} → ${placeCacheKey(jittered.lat, jittered.lng)} should still be Westfield, got ${fromJitter}`
  );
}

const d = distanceMeters(westfield.lat, westfield.lng, jittered.lat, jittered.lng);
if (!(d > 0 && d < 450)) {
  throw new Error(`boundary jitter should be well under 450 m, got ${d}`);
}

cache.set(placeCacheKey(40.7, -74.0), null);
if (nearestCachedPlace(cache, 40.7, -74.0) !== null) {
  throw new Error("pending/empty cache entries must not count as a town");
}

if (nearestCachedPlace(cache, 41.3, -72.9) !== null) {
  throw new Error("far GPS should not pick a distant cached town");
}

if (regionCode("US-NJ") !== "NJ") throw new Error("US-NJ should shorten to NJ");
if (regionCode("New Jersey") !== "NJ") throw new Error("New Jersey should shorten to NJ");
if (townFromBigDataCloud({
  city: "Westfield",
  locality: "Westfield",
  principalSubdivisionCode: "US-NJ",
}) !== "Westfield, NJ") {
  throw new Error("BigDataCloud Westfield parse");
}
if (townFromNominatim({
  address: { town: "Westfield", "ISO3166-2-lvl4": "US-NJ" },
}) !== "Westfield, NJ") {
  throw new Error("Nominatim Westfield parse");
}
if (townFromPhoton({
  features: [{
    properties: {
      name: "North Euclid Avenue",
      city: "Westfield",
      state: "New Jersey",
      countrycode: "US",
    },
  }],
}) !== "Westfield, NJ") {
  throw new Error("Photon Westfield parse");
}
if (townFromPhoton({
  features: [{ properties: { name: "North Euclid Avenue", countrycode: "US" } }],
}) !== "") {
  throw new Error("Photon must not use a street name as the town");
}
if (townFromPhoton({
  features: [{
    properties: {
      city: "Paris",
      country: "France",
      countrycode: "FR",
    },
  }],
}) !== "Paris, France") {
  throw new Error("Photon Paris should use country");
}
if (placeLabelFromPhotonProps({
  city: "Westfield",
  state: "New Jersey",
  countrycode: "US",
}) !== "Westfield, NJ") {
  throw new Error("placeLabel Westfield");
}
const searchHits = placesFromPhotonSearch({
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
      properties: { city: "Paris", country: "France", countrycode: "FR" },
    },
  ],
});
if (searchHits[0]?.label !== "Paris, France") {
  throw new Error("Photon search Paris label");
}
if (!photonSearchUrl("Westfield").includes("q=Westfield")) {
  throw new Error("photon search url should include query");
}
if (townFromBigDataCloud(null) !== "") throw new Error("empty geocode");
if (!photonReverseUrl(40.6568, -74.3465).includes("lon=-74.3465")) {
  throw new Error("Photon reverse URL should use lon,lat");
}

const nearbyClip = { lat: westfield.lat + 0.004, lng: westfield.lng };
if (nearestCachedPlace(cache, nearbyClip.lat, nearbyClip.lng, 1600) !== "Westfield, NJ") {
  throw new Error("clips within a mile should inherit the cached town");
}

console.log("place-geo tests passed");
