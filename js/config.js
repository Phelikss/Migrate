// Public, browser-visible configuration. Nothing in this file is secret.
// Never put the Supabase service-role key or any private token here.
window.MIGRATE_CONFIG = {
  // Google Maps JavaScript API key. Leave empty to use the OpenStreetMap fallback.
  // When set, RESTRICT it in Google Cloud Console to your site's HTTP referrers and to the
  // "Maps JavaScript API" only. See README > Google Maps.
  GOOGLE_MAPS_API_KEY: "",
  // Campus reference point used for distance and the map. Verify against the real gate location.
  CAMPUS: { lat: -1.2196, lng: 36.6676, name: "Presbyterian University of East Africa" },
};
