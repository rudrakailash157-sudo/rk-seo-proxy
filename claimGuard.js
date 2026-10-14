// ─── RKRTL claim guard ───────────────────────────────────────────────────────
// Deterministic safety net for how RKRTL is described in product copy.
//
// RKRTL is RudraKailash's own lab. Product copy must never call it
// "independent", "third-party", accredited or government-approved, and must
// always use its one correct name. This module does two things:
//
//   fixRkrtlClaims(text)   → rewrites the known bad phrasings into honest
//                            ones (e.g. "our independent RKRTL laboratory" →
//                            "our RKRTL laboratory") and returns what changed.
//   findRkrtlViolations(text) → lists anything still wrong after fixing.
//
// guardPayload(payload) runs both over body_html + meta title + meta
// description, and is called before EVERY write to Shopify. If anything is
// still wrong after the auto-fix, the push is blocked with a clear message —
// it never depends on the AI remembering a prompt rule.
//
// Still allowed (these describe the CUSTOMER checking the certificate, or say
// honestly that RKRTL is NOT independent):
//   "can be independently verified in seconds", "verify it independently",
//   "independently verifiable", "not an independent lab", "not a third-party lab"
// ─────────────────────────────────────────────────────────────────────────────

const RKRTL_FULL_NAME = "Kailasha Rudraksha Testing Laboratory";

// Ordered list — earlier rules handle the more specific phrasings first.
const FIX_RULES = [
  // Wrong expansions of the lab name, e.g. "RKRTL (Rudraksha Knowledge Research & Testing Laboratory)"
  { re: /RKRTL\s*\((?!Kailasha Rudraksha Testing Laboratory\))[^)]*\)/g,
    to: `RKRTL (${RKRTL_FULL_NAME})`, label: "wrong lab name" },
  // Not RudraKailash's method
  { re: /\bX-ray diffraction\b/gi, to: "X-ray imaging", label: "X-ray diffraction" },
  // "(an independent, third-party certification lab)" → removed
  { re: /\s*\(\s*an?\s+independent[^)]*\)/gi, to: "", label: "independent (bracket)" },
  // Old anchor heading
  { re: /Instant,\s*Independent Verification/gi, to: "Instant Online Verification", label: "independent (heading)" },
  // Customer check, worded oddly: "can be verified instantly and independently at rkrtl.com/verify"
  { re: /\b(verified|checked)\s+instantly\s+and\s+independently\b/gi, to: "$1 instantly by anyone", label: "verified instantly and independently" },
  // Not about the lab at all (Karungali FAQ): "are independently among the most sacred" → "are each among the most sacred"
  { re: /\bindependently\s+among\b/gi, to: "each among", label: "independently among" },
  // "our independent RKRTL laboratory" / "Our independent lab" → "our RKRTL laboratory" / "Our lab"
  { re: /\b(our)\s+independent\s+/gi, to: "$1 ", label: "our independent" },
  // "RKRTL's independent laboratory" → "RKRTL's laboratory"
  { re: /\b(RKRTL['’]s)\s+independent\s+/gi, to: "$1 ", label: "RKRTL's independent" },
  // "RKRTL independent laboratory certification" → "RKRTL laboratory certification"
  { re: /\bRKRTL\s+independent\s+/gi, to: "RKRTL ", label: "RKRTL independent" },
  // "independent RKRTL certification" → "RKRTL certification"
  { re: /\bindependent\s+(?=RKRTL\b)/gi, to: "", label: "independent RKRTL" },
  // "independently verified by RKRTL" → "verified by RKRTL"
  { re: /\b(i)ndependently\s+(verified\s+by)\b/gi, to: (m, i, rest) => (i === "I" ? "V" : "v") + rest.slice(1), label: "independently verified by" },
  // "independent laboratory verification" → "RKRTL laboratory verification"
  { re: /\bindependent\s+(laborator(?:y|ies)|lab)\s+(verification|testing|certification|analysis)\b/gi, to: "RKRTL $1 $2", label: "independent laboratory verification" },
  // "an independent gemological report" / "Independent lab certificate" → "an RKRTL lab report" / "RKRTL lab certificate"
  { re: /\b(an?\s+)?independent\s+(?:gemological\s+)?(?:lab(?:oratory)?\s+)?(report|certificate)\b/gi,
    to: (m, art, noun) => `${art ? (art[0] === "A" ? "An" : "an") + " " : ""}RKRTL lab ${noun.toLowerCase()}`, label: "independent report/certificate" },
  // "an independent X-ray certification lab" / "an independent testing facility" → "a Rudraksha testing lab/facility"
  { re: /\b(an?)\s+independent\s+(?:[\w-]+\s+){0,2}?(laboratory|lab|facility)\b/gi,
    to: (m, art, noun) => `${art[0] === "A" ? "A" : "a"} Rudraksha testing ${noun.toLowerCase()}`, label: "an independent lab" },
  // "undergoes independent X-ray imaging" → "undergoes X-ray imaging"
  { re: /\bindependent\s+(?=X-ray\b)/gi, to: "", label: "independent X-ray" },
  // "This independent verification" → "This RKRTL verification"
  { re: /\bindependent\s+(verification|certification|testing)\b/gi, to: "RKRTL $1", label: "independent verification" },
  // "third-party verification" / "third party validation" → "verification" / "validation"
  { re: /\bthird[-\s]party\s+/gi, to: "", label: "third-party" },
];

// ─── Product pages don't describe who owns the lab ───────────────────────────
// Decision (Oct 2026): product pages just say RKRTL tests the bead; the RKRTL
// certification page is the one place that states plainly it's RudraKailash's
// own lab. These rules only touch LAB wording — "capping done in-house" (the
// workshop) is left alone. Set to false to keep in-house wording on products.
const REMOVE_IN_HOUSE_LAB_WORDING = true;

const IN_HOUSE_RULES = [
  // "RKRTL is RudraKailash's in-house laboratory." → sentence removed
  { re: /\s*RKRTL is RudraKailash['’]s (?:own |in-house )+(?:testing )?laborator(?:y|ies)\.?/gi, to: "", label: "in-house (sentence)" },
  // "RKRTL, our in-house testing lab, before listing" → "RKRTL before listing"
  { re: /,\s*our (?:own |in-house )+(?:testing |authentication )?lab(?:oratory)?\s*,\s*/gi, to: " ", label: "our in-house lab" },
  // "…passes through RKRTL, our in-house testing lab." → "…passes through RKRTL."
  { re: /,\s*our (?:own |in-house )+(?:testing |authentication )?lab(?:oratory)?\b/gi, to: "", label: "our in-house lab" },
  // "is tested in-house by RKRTL" → "is tested by RKRTL"
  { re: /\b(tested|examined|verified|certified|checked)\s+in-house\s+(by|at)\s+(?=RKRTL\b)/gi, to: "$1 $2 ", label: "tested in-house" },
  // Whole founder sentence → organisation voice (Oct 2026: to the world
  // RudraKailash is an organisation, and it will grow beyond one person):
  // "RudraKailash is run by one person, Subramani Lakshmanan, who has bought
  // Rudraksha from the same farming families in Nepal for nine years, …" →
  // "Our relationships with the same farming families in Nepal go back nine
  // years. Every bead is X-ray tested and certified by RKRTL, and every silver
  // cap is fitted by hand in our own workshop."
  { re: /RudraKailash is run by one person,\s*Subramani Lakshmanan,\s*who has (?:bought|sourced) Rudraksha from the same farming families in Nepal for (\w+) years,[^.]*\./gi,
    to: "Our relationships with the same farming families in Nepal go back $1 years. Every bead is X-ray tested and certified by RKRTL, and every silver cap is fitted by hand in our own workshop.",
    label: "founder sentence" },
  // Founder line (other variants): "tests every bead himself in the RKRTL lab" →
  // "makes sure every bead is X-ray tested and certified by RKRTL"
  { re: /\btests (every|each) bead himself (?:in|at) (?:the )?RKRTL(?: lab(?:oratory)?)?/gi,
    to: "makes sure $1 bead is X-ray tested and certified by RKRTL", label: "tests every bead himself" },
  // "in our own lab, RKRTL" / "in our RKRTL lab" → "at RKRTL"
  { re: /\bin our (?:own |in-house )+lab(?:oratory)?,?\s+(?=RKRTL\b)/gi, to: "at ", label: "in our own lab" },
];
if (REMOVE_IN_HOUSE_LAB_WORDING) FIX_RULES.push(...IN_HOUSE_RULES);

// Anything matching these after fixing blocks the push…
const BANNED = [
  { re: /\bindependent(ly)?\b/gi,       label: "independent" },
  { re: /\bthird[-\s]party\b/gi,        label: "third-party" },
  { re: /\bX-ray diffraction\b/gi,      label: "X-ray diffraction" },
  { re: /\baccredited\b/gi,             label: "accredited" },
  { re: /\bgovernment[-\s]approved\b/gi, label: "government-approved" },
  { re: /\bNABL\b/g,                    label: "NABL" },
  { re: /\bISO\s?\/?\s?(IEC\s*)?17025\b/gi, label: "ISO 17025" },
  { re: /RKRTL\s*\((?!Kailasha Rudraksha Testing Laboratory\))[^)]*\)/g, label: "wrong lab name" },
];

// …unless the match sits inside one of these honest phrasings.
const ALLOWED_CONTEXTS = [
  /\bcan be independently verif\w*/gi,          // the customer checks the certificate
  /\bverif\w*\s+(it\s+|them\s+)?independently\b/gi,
  /\bindependently\s+verifiable\b/gi,
  /\bnot\s+(an?\s+)?independent\b[^.]*/gi,       // "not an independent third-party lab"
  /\bnot\s+(a\s+)?third[-\s]party\b[^.]*/gi,
];

function stripTags(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function fixRkrtlClaims(text) {
  let out = String(text || "");
  const changes = [];
  // Protect honest phrasings ("not an independent lab", "verify it
  // independently") so the rewrite rules never touch them.
  const kept = [];
  for (const re of ALLOWED_CONTEXTS) {
    out = out.replace(re, m => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  }
  for (const rule of FIX_RULES) {
    out = out.replace(rule.re, (...args) => {
      const match = args[0];
      const replacement = typeof rule.to === "function"
        ? rule.to(...args)
        : rule.to.replace(/\$(\d)/g, (_, n) => args[Number(n)] || "");
      if (replacement !== match) changes.push({ rule: rule.label, from: match.trim(), to: replacement.trim() });
      return replacement;
    });
  }
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  return { text: out, changes };
}

function findRkrtlViolations(text) {
  const plain = stripTags(text);
  // Blank out honest phrasings so they don't trip the ban list.
  let masked = plain;
  for (const re of ALLOWED_CONTEXTS) masked = masked.replace(re, m => " ".repeat(m.length));
  const found = [];
  for (const { re, label } of BANNED) {
    for (const m of masked.matchAll(re)) {
      const start = Math.max(0, m.index - 60), end = Math.min(plain.length, m.index + m[0].length + 60);
      found.push({ term: label, snippet: "…" + plain.slice(start, end).trim() + "…" });
    }
  }
  return found;
}

const GUARDED_FIELDS = ["body_html", "metafields_global_title_tag", "metafields_global_description_tag"];

// Auto-fixes the payload in place, then reports anything still wrong.
// Returns { payload, changes, violations }. Push only when violations is empty.
function guardPayload(payload) {
  const fixed = { ...(payload || {}) };
  const changes = [], violations = [];
  for (const field of GUARDED_FIELDS) {
    if (typeof fixed[field] !== "string" || !fixed[field]) continue;
    const r = fixRkrtlClaims(fixed[field]);
    fixed[field] = r.text;
    r.changes.forEach(c => changes.push({ field, ...c }));
    findRkrtlViolations(r.text).forEach(v => violations.push({ field, ...v }));
  }
  return { payload: fixed, changes, violations };
}

function violationMessage(violations) {
  return "Blocked: this content describes RKRTL in a way that isn't accurate (RKRTL is our own lab). " +
    "Fix these lines and push again:\n" +
    violations.map(v => `• [${v.field}] "${v.term}": ${v.snippet}`).join("\n");
}

module.exports = { fixRkrtlClaims, findRkrtlViolations, guardPayload, violationMessage, RKRTL_FULL_NAME };
