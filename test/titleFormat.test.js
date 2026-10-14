const { LOCKED_TITLES, getLockedTitle } = require("../titleFormat");
let fail = 0;
const expect = (h, want) => { const got = getLockedTitle(h); if (got !== want) { fail++; console.log("MISMATCH", h, "→", got, "want", want); } };
expect("1-mukhi-rudraksha", "1 Mukhi Half-Moon Rudraksha | Rameshwaram | X-Ray Verified | Lab Certified");
expect("2-mukhi-rudraksha", "2 Mukhi Rudraksha | Original Himalayan | X-Ray Verified | Lab Certified");
expect("7-mukhi-rudraksha", "7 Mukhi Rudraksha | Original Nepali | X-Ray Verified | Lab Certified");
expect("14-mukhi-rudraksha", "14 Mukhi Rudraksha | Original Nepali | X-Ray Verified | Lab Certified");
expect("gauri-shankar-rudraksha", "Gauri Shankar Rudraksha | Original Nepali | X-Ray Verified | Lab Certified");
expect("ganesh-mukhi-rudraksha", "Ganesh Rudraksha | Original Nepali | X-Ray Verified | Lab Certified");
// Not single beads → untouched
for (const h of ["7-mukhi-rudraksha-mala", "8-mukhi-rudraksha-bracelet", "1-mukhi-bracelet", "shree-ganesh-lakshmi-bandh", "ebony-karungali-mala", ""]) if (getLockedTitle(h) !== null) { fail++; console.log("SHOULD BE NULL", h); }
if (Object.keys(LOCKED_TITLES).length !== 16) { fail++; console.log("Expected 16 titles, got", Object.keys(LOCKED_TITLES).length); }
for (const [h, t] of Object.entries(LOCKED_TITLES)) if (/  |RudraKailash/.test(t)) { fail++; console.log("Bad spacing/brand", h, t); }
console.log(fail ? `${fail} TITLE FAILURES` : "TITLES ALL PASS");
process.exit(fail ? 1 : 0);
