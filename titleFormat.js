// ─── Locked title format for single-bead Rudraksha pages ────────────────────
// Decision (Subbu, Oct 2026): every single-bead page uses
//   "{Bead} | {Origin} | X-Ray Verified | Lab Certified"
// in that order. The brand is NOT in the title — the Shopify theme already
// appends " – Rudra Kailash" to every page title.
//
// This is a plain lookup by product handle (the URL slug, which never changes
// when a title is edited), so the AI never decides the title for these pages.
// To change a title, edit it here — nowhere else.
// ─────────────────────────────────────────────────────────────────────────────

const SUFFIX = " | X-Ray Verified | Lab Certified";

const LOCKED_TITLES = {
  "1-mukhi-rudraksha":       "1 Mukhi Half-Moon Rudraksha | Rameshwaram" + SUFFIX,
  "2-mukhi-rudraksha":       "2 Mukhi Rudraksha | Original Himalayan" + SUFFIX,
  "gauri-shankar-rudraksha": "Gauri Shankar Rudraksha | Original Nepali" + SUFFIX,
  "ganesh-mukhi-rudraksha":  "Ganesh Rudraksha | Original Nepali" + SUFFIX,
};
for (let n = 3; n <= 14; n++) {
  LOCKED_TITLES[`${n}-mukhi-rudraksha`] = `${n} Mukhi Rudraksha | Original Nepali` + SUFFIX;
}

// Returns the locked title for a single-bead page, or null for every other
// product (malas, bracelets, combos, Karungali, services…), which keep their
// existing behaviour.
function getLockedTitle(handle) {
  return LOCKED_TITLES[String(handle || "").trim().toLowerCase()] || null;
}

module.exports = { LOCKED_TITLES, getLockedTitle };
