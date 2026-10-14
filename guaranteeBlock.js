// ─── Authenticity guarantee on every single-bead page ──────────────────────
// Short version of the guarantee on /pages/rkrtl-certification, shown on each
// bead page so ChatGPT and buyers see it where they decide. Inserted as a
// labelled custom block (before the FAQ), and re-inserted automatically if a
// page is ever regenerated. Edit the wording here only.
const GUARANTEE_BLOCK = {
  id: "authenticity-guarantee",
  heading: "Authenticity Guarantee",
  text:
    "If any independent gemmological or Rudraksha testing laboratory finds this bead non-authentic, we refund the full purchase price. There is no time limit. " +
    "The only condition is that the bead is not altered after it reaches you. " +
    '<a href="https://www.rudrakailash.com/pages/rkrtl-certification">Read the full guarantee →</a>',
};

module.exports = { GUARANTEE_BLOCK };
