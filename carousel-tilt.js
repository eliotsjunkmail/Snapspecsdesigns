/** Map look-down-positive pitch to 0 (bottom row) … 1 (top row). */
export function carouselTiltAmount(pitch, span, gain = 1) {
  if (!(span > 1e-6)) return 0;
  const g = Number.isFinite(gain) && gain > 0 ? gain : 1;
  return Math.min(1, Math.max(0, (-pitch * g) / span));
}

/**
 * Signed tilt across the header–shutter band.
 * −1 = look down (photos toward the top bar), +1 = look up (photos toward the lens floor).
 */
export function carouselTiltTravel(pitch, span, gain = 1) {
  if (!(span > 1e-6)) return 0;
  const g = Number.isFinite(gain) && gain > 0 ? gain : 1;
  return Math.min(1, Math.max(-1, (-pitch * g) / span));
}

/**
 * Convert a viewport Y (0 at top) into world Y on a plane `dist` meters
 * in front of a level camera.
 */
export function screenYToWorldY(screenY, viewH, camY, dist, vFovDeg) {
  if (!(viewH > 0) || !(dist > 0) || !(vFovDeg > 0) || !Number.isFinite(screenY)) {
    return camY;
  }
  const halfH = dist * Math.tan((vFovDeg * Math.PI) / 360);
  const ndcY = 1 - (2 * screenY) / viewH;
  return camY + ndcY * halfH;
}

/** Header bottom → viewport floor, in CSS pixels. */
export function carouselHudBandPx(
  hudBottom,
  viewBottom,
  viewH,
  topPad = 10,
  botPad = 4
) {
  const h = viewH > 0 ? viewH : 800;
  const topPx = Number.isFinite(hudBottom) ? hudBottom + topPad : Math.min(72, h * 0.1);
  const floor = Number.isFinite(viewBottom) ? viewBottom : h;
  const botPx = Math.max(topPx + 8, floor - botPad);
  return { topPx, botPx };
}

/** Keep the unshifted stack inside [bandBottom, bandTop] after `shiftY`. */
export function clampShiftToBand(shiftY, stackBottom, stackTop, bandBottom, bandTop) {
  const stackH = stackTop - stackBottom;
  const bandH = bandTop - bandBottom;
  if (!(stackH > 0) || !(bandH > 0)) return shiftY;
  const lo = bandBottom - stackBottom;
  const hi = bandTop - stackTop;
  if (lo > hi) {
    // Taller than the band: stay on the end the user is asking for.
    return shiftY < (lo + hi) * 0.5 ? lo : hi;
  }
  return Math.min(hi, Math.max(lo, shiftY));
}

/**
 * Horizontal-only aim angle so dragging the ring down does not drop focus.
 * 0 = on heading, π = behind you.
 */
export function carouselAimAngle(fromX, fromZ, toX, toZ, fwdX, fwdZ) {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const dlen = Math.hypot(dx, dz);
  const flen = Math.hypot(fwdX, fwdZ);
  if (dlen < 1e-6 || flen < 1e-6) return Math.PI;
  return Math.acos(
    Math.min(1, Math.max(-1, (dx * fwdX + dz * fwdZ) / (dlen * flen)))
  );
}

/** Ignore tiny viewport chatter (iOS chrome) so the floor does not bounce. */
export function stickyViewSize(prev, next, slack = 12) {
  if (!(next > 0)) return prev > 0 ? prev : 1;
  if (prev > 0 && Math.abs(next - prev) < slack) return prev;
  return next;
}

/** t=0 stays at rest; t→−1 reaches the header; t→+1 reaches the lens floor. */
export function carouselTravelShiftY(tiltT, restShift, highShift, lowShift) {
  const t = Math.min(1, Math.max(-1, Number.isFinite(tiltT) ? tiltT : 0));
  if (t <= 0) return restShift + (highShift - restShift) * -t;
  return restShift + (lowShift - restShift) * t;
}

/** Vertical shift so t=0 centers the bottom row on the camera, t=1 the top. */
export function carouselRowShiftY(camY, bottomY, topY, t) {
  const shiftBottom = camY - bottomY;
  const shiftTop = camY - topY;
  const k = Math.min(1, Math.max(0, t));
  return shiftBottom + (shiftTop - shiftBottom) * k;
}

export function carouselRowSpan(bottomY, topY, dist) {
  const rise = Math.abs(topY - bottomY);
  if (!(dist > 0.2) || rise < 0.05) return 0;
  return Math.atan2(rise, dist);
}

/**
 * Pitch relative to the pose when the lens opened (or carousel was selected).
 * Missing baseline keeps the home view (0).
 */
export function carouselRelativePitch(pitch, baseline) {
  if (!Number.isFinite(pitch) || !Number.isFinite(baseline)) return 0;
  return pitch - baseline;
}

/**
 * Finger-up is negative screen dy. Positive lift moves the ring up
 * so the carousel follows the finger.
 */
export function carouselDragLiftDelta(screenDyPx) {
  return -screenDyPx;
}

/** Consecutive same-year clips share one mark. */
export function carouselYearGroups(years) {
  const groups = [];
  (years || []).forEach((year, i) => {
    if (year == null) return;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.indices.push(i);
    else groups.push({ year, indices: [i] });
  });
  return groups;
}

/** Sit just under the lowest clip so travel keeps the years with the stack. */
export function carouselYearMarkY(stackBottom, gap = 0.36) {
  return (Number(stackBottom) || 0) - gap;
}

/** Pull the year slightly toward the viewer so a front clip cannot cover it. */
export function carouselYearMarkRadius(radius, pull = 0.3) {
  const r = Number(radius) || 0;
  return Math.max(0.8, r - pull);
}

/** Smallest angle so neighboring year labels do not run together. */
export function carouselYearMarkMinAngle(radius, markWidth = 2.3, pad = 0.5) {
  const r = Math.max(0.8, Number(radius) || 6.2);
  return (markWidth + pad) / r;
}

/** Push year marks apart along the ring, keeping order. */
export function spreadYearMarkAngles(alphas, minGap) {
  const list = Array.isArray(alphas) ? alphas.slice() : [];
  const n = list.length;
  if (n < 2) return list;
  const gap = Number.isFinite(minGap) && minGap > 0 ? minGap : 0;
  if (!(gap > 0)) return list;
  const out = [list[0]];
  for (let i = 1; i < n; i += 1) {
    let a = list[i];
    const prev = out[i - 1];
    while (a < prev - Math.PI) a += Math.PI * 2;
    while (a > prev + Math.PI) a -= Math.PI * 2;
    if (a < prev + gap) a = prev + gap;
    out.push(a);
  }
  return out;
}

/** Keep a taken year on the focus line when the title omitted it. */
export function carouselFocusLabel(title, year, thumbs = 0) {
  const base = String(title || "").trim();
  const labeled = thumbs > 0 ? `${base} 👍${thumbs > 1 ? thumbs : ""}` : base;
  if (!year) return labeled;
  if (labeled.includes(String(year))) return labeled;
  return labeled ? `${labeled} · ${year}` : String(year);
}
