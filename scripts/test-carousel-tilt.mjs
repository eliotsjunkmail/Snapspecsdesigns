import {
  carouselTiltAmount,
  carouselRowShiftY,
  carouselRowSpan,
  carouselDragLiftDelta,
  carouselRelativePitch,
  carouselTiltTravel,
  screenYToWorldY,
  carouselHudBandPx,
  clampShiftToBand,
  carouselTravelShiftY,
  carouselAimAngle,
  stickyViewSize,
  carouselYearGroups,
  carouselYearMarkY,
  carouselYearMarkRadius,
  carouselYearMarkMinAngle,
  spreadYearMarkAngles,
  carouselFocusLabel,
} from "../carousel-tilt.js";

if (carouselTiltAmount(0, 0.2) !== 0) {
  throw new Error("horizon should keep the bottom row");
}
if (carouselTiltAmount(0.15, 0.2) !== 0) {
  throw new Error("leaning forward should stay on the bottom row");
}
if (Math.abs(carouselTiltAmount(-0.2, 0.2) - 1) > 1e-9) {
  throw new Error("full look-up should reach the top row");
}
if (Math.abs(carouselTiltAmount(-0.1, 0.2) - 0.5) > 1e-9) {
  throw new Error("halfway look-up should sit between rows");
}
if (carouselTiltAmount(-1, 0.2) !== 1) {
  throw new Error("extra look-up should clamp to the top row");
}
if (Math.abs(carouselTiltAmount(-0.1, 0.2, 2) - 1) > 1e-9) {
  throw new Error("tilt gain should reach the top row with less lean");
}
if (Math.abs(carouselTiltAmount(-0.05, 0.2, 2) - 0.5) > 1e-9) {
  throw new Error("tilt gain should scale look-up travel");
}

const camY = 1.4;
const bottomY = 1.0;
const topY = 2.4;
if (Math.abs(carouselRowShiftY(camY, bottomY, topY, 0) - (camY - bottomY)) > 1e-9) {
  throw new Error("t=0 should center the bottom row");
}
if (Math.abs(carouselRowShiftY(camY, bottomY, topY, 1) - (camY - topY)) > 1e-9) {
  throw new Error("t=1 should center the top row");
}

const span = carouselRowSpan(1.0, 2.4, 6.2);
if (!(span > 0.15 && span < 0.3)) {
  throw new Error(`row span should be a small lean, got ${span}`);
}

if (carouselDragLiftDelta(-0.2) <= 0) {
  throw new Error("finger-up should lift the ring");
}
if (carouselDragLiftDelta(0.2) >= 0) {
  throw new Error("finger-down should lower the ring");
}
if (carouselDragLiftDelta(-80) !== 80) {
  throw new Error("drag lift should invert screen dy");
}

if (carouselRelativePitch(0.18, 0.18) !== 0) {
  throw new Error("initial phone tilt should be the home pose");
}
if (Math.abs(carouselRelativePitch(-0.05, 0.15) - -0.2) > 1e-9) {
  throw new Error("tilting up from the start pose should be relative");
}
if (carouselTiltAmount(carouselRelativePitch(0.2, 0.2), 0.2) !== 0) {
  throw new Error("opening while looking down should keep the bottom row");
}
if (Math.abs(carouselTiltAmount(carouselRelativePitch(-0.05, 0.15), 0.2) - 1) > 1e-9) {
  throw new Error("looking up from a down start should reach the top row");
}
if (carouselRelativePitch(0.1, null) !== 0) {
  throw new Error("no baseline should hold the home view");
}

function carouselDropShiftY(y, drop = -0.2) {
  return y - drop;
}
if (carouselDropShiftY(1.4) <= 1.4) {
  throw new Error("default carousel should sit slightly above camera height");
}
if (Math.abs(carouselDropShiftY(1.4, -0.2) - 1.6) > 1e-9) {
  throw new Error("negative drop should raise clips with the viewfinder");
}

function defaultVideoSize(stored) {
  if (stored === "large" || stored === "small") return stored;
  return "small";
}
if (defaultVideoSize(null) !== "small") throw new Error("new users should get small clips");
if (defaultVideoSize("large") !== "large") throw new Error("saved large should stick");
if (defaultVideoSize("small") !== "small") throw new Error("saved small should stick");

if (Math.abs(carouselTiltTravel(0, 0.36) - 0) > 1e-9) {
  throw new Error("level phone should stay at rest travel");
}
if (carouselTiltTravel(0.2, 0.36) >= 0) {
  throw new Error("looking down should send photos toward the header");
}
if (carouselTiltTravel(-0.2, 0.36) <= 0) {
  throw new Error("looking up should send photos toward the lens floor");
}
if (Math.abs(carouselTiltTravel(-0.36, 0.36) - 1) > 1e-9) {
  throw new Error("full look-up should reach the lens floor");
}
if (Math.abs(carouselTiltTravel(0.36, 0.36) - -1) > 1e-9) {
  throw new Error("full look-down should reach the header end");
}
if (carouselTiltTravel(-1, 0.36) !== 1) {
  throw new Error("extra look-up should clamp to the lens floor");
}

const midY = screenYToWorldY(400, 800, 1.4, 6.2, 60);
if (Math.abs(midY - 1.4) > 1e-9) {
  throw new Error("screen mid should sit at camera height");
}
const screenTopY = screenYToWorldY(0, 800, 1.4, 6.2, 60);
const screenBotY = screenYToWorldY(800, 800, 1.4, 6.2, 60);
if (!(screenTopY > midY && screenBotY < midY)) {
  throw new Error("screen top should be above camera, bottom below");
}
const halfH = 6.2 * Math.tan((60 * Math.PI) / 360);
if (Math.abs(screenTopY - (1.4 + halfH)) > 1e-9) {
  throw new Error("top of screen should match the frustum half-height");
}

const band = carouselHudBandPx(64, 800, 800);
if (band.topPx !== 74) throw new Error("band top should sit just under the header");
if (band.botPx !== 796) throw new Error("band bottom should sit on the lens floor");

if (Math.abs(clampShiftToBand(0, 0, 2, -1, 5) - 0) > 1e-9) {
  throw new Error("a stack already in the band should keep its shift");
}
if (Math.abs(clampShiftToBand(4, 0, 2, -1, 5) - 3) > 1e-9) {
  throw new Error("shift should stop when the stack hits the header");
}
if (Math.abs(clampShiftToBand(-3, 0, 2, -1, 5) - -1) > 1e-9) {
  throw new Error("shift should stop when the stack hits the lens floor");
}
const pinnedLow = clampShiftToBand(-10, 0, 8, -1, 5);
if (Math.abs(pinnedLow - -1) > 1e-9) {
  throw new Error("a taller stack should stay on the floor when pulled down");
}
const pinnedHigh = clampShiftToBand(10, 0, 8, -1, 5);
if (Math.abs(pinnedHigh - -3) > 1e-9) {
  throw new Error("a taller stack should stay on the header when lifted");
}

if (Math.abs(carouselAimAngle(0, 0, 0, -6.2, 0, -1)) > 1e-9) {
  throw new Error("a clip on heading should stay aimed after it slides down");
}
if (carouselAimAngle(0, 0, 6.2, 0, 0, -1) < 1.5) {
  throw new Error("a clip off to the side should stay outside the aim cone");
}

if (stickyViewSize(844, 848) !== 844) {
  throw new Error("tiny viewport chatter should not move the floor");
}
if (stickyViewSize(844, 700) !== 700) {
  throw new Error("a real resize should update the floor");
}

const yearGroups = carouselYearGroups([2011, 2011, 2014, 2015]);
if (yearGroups.length !== 3) throw new Error("consecutive years should share a mark");
if (yearGroups[0].indices.join(",") !== "0,1") {
  throw new Error("2011 clips should group together");
}
if (Math.abs(carouselYearMarkY(0.05) - -0.31) > 1e-9) {
  throw new Error("year marks should sit just under the stack");
}
if (carouselYearMarkRadius(6.2) >= 6.2) {
  throw new Error("year marks should sit in front of the ring");
}
if (carouselFocusLabel("Clip Jul 16", 2024) !== "Clip Jul 16 · 2024") {
  throw new Error("focus line should restore a missing year");
}
if (carouselFocusLabel("Picnic 2024", 2024) !== "Picnic 2024") {
  throw new Error("a title that already has the year should stay put");
}

const piled = spreadYearMarkAngles([0, 0], carouselYearMarkMinAngle(6));
if (piled[1] - piled[0] < carouselYearMarkMinAngle(6) - 1e-9) {
  throw new Error("stacked years should be pushed apart");
}
const roomy = spreadYearMarkAngles([-0.6, 0.6], 0.3);
if (Math.abs(roomy[0] + 0.6) > 1e-9 || Math.abs(roomy[1] - 0.6) > 1e-9) {
  throw new Error("years that already have room should stay put");
}

if (Math.abs(carouselTravelShiftY(0, 0.2, 3, -3) - 0.2) > 1e-9) {
  throw new Error("neutral tilt should keep the rest pose");
}
if (Math.abs(carouselTravelShiftY(-1, 0.2, 3, -3) - 3) > 1e-9) {
  throw new Error("full look-down should lift to the header");
}
if (Math.abs(carouselTravelShiftY(1, 0.2, 3, -3) - -3) > 1e-9) {
  throw new Error("full look-up should drop to the lens floor");
}
if (Math.abs(carouselTravelShiftY(-0.5, 0.2, 3, -3) - 1.6) > 1e-9) {
  throw new Error("halfway look-down should sit between rest and the header");
}

const focusDown = clampShiftToBand(-8, 1.5, 4, -2, 6);
if (Math.abs(focusDown - -3.5) > 1e-9) {
  throw new Error("a focused clip should be able to drop its bottom to the lens floor");
}

function nodePosterReady(node) {
  if (!node || node.kind === "image") return true;
  if (node.posterFailed) return true;
  if (!node.posterSrc && !node.storagePath && !node.thumbUrl) return true;
  return Boolean(node.posterTex);
}
if (!nodePosterReady({ kind: "image" })) throw new Error("creations need no poster wait");
if (nodePosterReady({ kind: "video", storagePath: "x", posterTex: null })) {
  throw new Error("cloud clips should wait for a poster");
}
if (!nodePosterReady({ kind: "video", storagePath: "x", posterTex: {} })) {
  throw new Error("loaded poster should clear the spinner");
}

console.log("carousel-tilt tests passed");
