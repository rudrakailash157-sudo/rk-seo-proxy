const { fixRkrtlClaims, findRkrtlViolations, guardPayload } = require("../claimGuard");
const bad = [
 "Each bead is X-rayed by RKRTL (Kailasha Rudraksha Testing Laboratory), an independent X-ray certification lab that verifies mukhi count and internal ridge structure.",
 "<h3>Instant, Independent Verification</h3><p>Every RKRTL certificate can be independently verified in seconds.</p>",
 "Our independent lab confirms the botanical identity of Elaeocarpus ganitrus, validates mukhi count.",
 "Every bead is examined by RKRTL, an independent laboratory specializing in Rudraksha verification.",
 "RKRTL's independent laboratory issues a detailed certificate with a unique identification number.",
 "by RKRTL, an independent laboratory specializing in botanical authentication.",
 "Each authentic specimen arrives with independent RKRTL certification and a unique ID.",
 "Certified by RKRTL (Kailasha Rudraksha Testing Laboratory) (an independent, third-party certification lab).",
 "Every Ganesh bead is authenticated through independent verification standards.",
 "Each bead is independently verified by RKRTL certification.",
 "each bead undergoes independent X-ray imaging and microscopy verification at RKRTL laboratories, with a QR code you can scan to verify it independently.",
 "RKRTL certification provides third-party verification, ensuring the botanical specimen is genuine.",
 "authenticated at RKRTL, an independent authentication laboratory.",
 "tested at RKRTL (Rudraksha Kailash Research & Testing Laboratory), an independent gemological facility.",
 "Our bracelets undergo rigorous third-party laboratory verification using X-ray diffraction and density analysis to confirm.",
 "Each bead is traceable through RKRTL's independent laboratory database.",
 "RKRTL independent laboratory certification confirming authenticity. RKRTL independent laboratory testing using high-resolution X-ray imaging.",
 "This independent verification ensures buyers receive genuinely sourced Nepali beads.",
 "Each bead is independently verified by RKRTL laboratory certification to ensure authenticity. This independent verification protects seekers.",
 "tested at RKRTL (Rudraksha Knowledge Research & Testing Laboratory), an independent testing facility.",
 "Each 10 Mukhi bead undergoes X-ray imaging at our independent RKRTL laboratory. Each bead carries independent RKRTL verification.",
 "verified by RKRTL, an independent certification facility.",
 "RKRTL's independent laboratory verification includes bead density analysis.",
 "Each 108-bead mala arrives lab-verified through RKRTL's independent certification process.",
 "Verification: Independent lab report included.",
 "Independent lab certificate verifies botanical origin and finish",
 "by RKRTL, an independent laboratory, confirming genuine Elaeocarpus ganitrus botanical origin.",
 "Independently verified by RKRTL laboratory imaging, this mala bridges traditional Vedic practice.",
 "Lab Certified: Accompanied by an independent gemological report confirming botanical authenticity.",
 "RKRTL, our independent authentication laboratory, ensuring genuine origin. Traceable through our independent verification database.",
 "undergoes rigorous X-ray imaging and microscopy at our independent RKRTL laboratory.",
 "RKRTL's independent X-ray imaging and microscopic analysis confirm the bead.",
 "A fair price represents the cost of ethical sourcing, skilled capping and finishing and third party validation.",
];
let fail=0;
for (const s of bad) {
  const { text } = fixRkrtlClaims(s);
  const v = findRkrtlViolations(text);
  if (v.length) { fail++; console.log("STILL BAD:", text, v.map(x=>x.term)); }
  else console.log("✓", text);
}
// must remain allowed untouched
const ok = [
 "Every RKRTL certificate can be independently verified in seconds.",
 "Scan the QR code to verify it independently.",
 "The certificate is independently verifiable.",
 "RKRTL is our own lab. It is not an independent third-party lab, and we say so plainly.",
 "Every bead is X-ray tested and certified by RKRTL (Kailasha Rudraksha Testing Laboratory).",
];
for (const s of ok) { const r=fixRkrtlClaims(s); const v=findRkrtlViolations(r.text); if (r.text!==s||v.length){fail++;console.log("WRONGLY CHANGED/FLAGGED:",s,"=>",r.text,v);} }
// things the fixer can't rewrite must be blocked
const block = ["Tested at a government-approved lab.", "Our lab is NABL accredited.", "RKRTL is fully independent."];
for (const s of block) { const g=guardPayload({body_html:s}); if(!g.violations.length){fail++;console.log("NOT BLOCKED:",s);} }
console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");

// ── In-house lab wording is removed from product copy (Oct 2026 decision) ──
const inHouse = [
 ["…examined by RKRTL, our in-house testing lab, before it's listed.", "…examined by RKRTL before it's listed."],
 ["The bead is tested in-house by RKRTL (Kailasha Rudraksha Testing Laboratory), and ships with its own certificate.", "The bead is tested by RKRTL (Kailasha Rudraksha Testing Laboratory), and ships with its own certificate."],
 ["Every 4 Mukhi sold here is examined by RKRTL, our in-house lab, before listing:", "Every 4 Mukhi sold here is examined by RKRTL before listing:"],
 ["<p>Each bead is checked. RKRTL is RudraKailash's in-house laboratory.</p>", "<p>Each bead is checked.</p>"],
 ["Before a 5 Mukhi is listed for sale, it passes through RKRTL, our in-house testing lab.", "Before a 5 Mukhi is listed for sale, it passes through RKRTL."],
 ["every bead is lab certified by RKRTL, our in-house lab, with X-ray, density and microscopic checks before it is listed.", "every bead is lab certified by RKRTL with X-ray, density and microscopic checks before it is listed."],
 ["Every 14 Mukhi we sell is sourced from Nepal and examined by RKRTL, our in-house testing lab, before listing.", "Every 14 Mukhi we sell is sourced from Nepal and examined by RKRTL before listing."],
 ["RudraKailash is run by one person, Subramani Lakshmanan, who has bought Rudraksha from the same farming families in Nepal for nine years, tests every bead himself in the RKRTL lab, and fits every silver cap by hand.",
  "Our relationships with the same farming families in Nepal go back nine years. Every bead is X-ray tested and certified by RKRTL, and every silver cap is fitted by hand in our own workshop."],
 ["<p>RudraKailash is run by one person, Subramani Lakshmanan, who has bought Rudraksha from the same farming families in Nepal for nine years, tests each bead himself at the RKRTL lab, and fits every silver cap by hand. Nepali 6 Mukhi beads are larger.</p>",
  "<p>Our relationships with the same farming families in Nepal go back nine years. Every bead is X-ray tested and certified by RKRTL, and every silver cap is fitted by hand in our own workshop. Nepali 6 Mukhi beads are larger.</p>"],
 ["All silver and metal capping work is done in-house.", "All silver and metal capping work is done in-house."],
 ["Silver capping, done by hand in our own workshop after certification.", "Silver capping, done by hand in our own workshop after certification."],
];
for (const [input, want] of inHouse) {
  const got = fixRkrtlClaims(input).text;
  if (got !== want) { fail++; console.log("IN-HOUSE MISMATCH:\n  in:  " + input + "\n  got: " + got + "\n  want:" + want); }
}
console.log(fail ? `${fail} FAILURES (incl. in-house)` : "IN-HOUSE ALL PASS");
process.exit(fail ? 1 : 0);
