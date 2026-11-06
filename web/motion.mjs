import { animate, createDrawable, createTimeline, stagger } from "./vendor/anime-4.5.0.mjs";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const waveElement = document.querySelector("[data-wave]");
const hero = document.querySelector(".hero");
const rippleMap = document.getElementById("ripple-map");
const restingRipple = Number(rippleMap.getAttribute("scale"));
let entrance;
let results;
let mode;
let youtubeIntro;
let ripple;

// Content must never stay hidden: if frames stop (background tab, throttled
// pane), finish the entrance on a timer instead of waiting for rAF.
function settle(animation, ms) {
  setTimeout(() => { if (!animation.completed) animation.complete(); }, ms);
  return animation;
}

function rippleTo(scale, duration, from) {
  ripple?.pause();
  const state = { scale: from ?? Number(rippleMap.getAttribute("scale")) };
  ripple = animate(state, {
    scale, duration, ease: "out(3)",
    onUpdate: () => rippleMap.setAttribute("scale", state.scale.toFixed(1)),
  });
}

export function revealHero() {
  entrance?.revert();
  if (reduceMotion.matches) return;
  const loaded = hero.closest("[data-loaded]");
  entrance = createTimeline({ defaults: { ease: "out(4)" } })
    .add(hero.querySelectorAll("#headline .line > span, .echo .line > span"), {
      opacity: [0, 1], y: ["0.42em", "0em"], duration: 760, delay: stagger(90, { grid: [2, 2], axis: "x" }),
    }, 0)
    .add(hero.querySelector(".eyebrow"), { opacity: [0, 1], x: [-12, 0], duration: 520 }, 0)
    .add(hero.querySelectorAll(".hero-copy [data-hero]"), {
      opacity: [0, 1], y: [18, 0], duration: 560, delay: stagger(70),
    }, loaded ? 80 : 260)
    .add(hero.querySelector(".portal"), { opacity: [0.55, 1], scale: [1.06, 1], duration: 1300, ease: "out(3)" }, 0);
  settle(entrance, 1800);
  if (!loaded) rippleTo(restingRipple, 1600, 70);
}

export function rippleDrag(active) {
  if (reduceMotion.matches) return;
  rippleTo(active ? 46 : restingRipple, active ? 500 : 900);
}

export function revealWave() {
  if (reduceMotion.matches) return;
  animate(createDrawable(waveElement), {
    draw: ["0 0", "0 1"], duration: 640, ease: "out(3)", onComplete: resetWave,
  });
}

export function revealYoutube(element) {
  youtubeIntro?.revert();
  if (reduceMotion.matches) return;
  youtubeIntro = settle(animate(element.querySelectorAll(".youtube-intro > *, .youtube-body"), {
    opacity: [0, 1], y: [24, 0], duration: 620, delay: stagger(80), ease: "out(4)",
  }), 1400);
}

export function revealResults(elements) {
  resetResultsMotion();
  if (reduceMotion.matches) return;
  results = settle(animate(elements, {
    opacity: [0, 1], x: [-16, 0], duration: 520, delay: stagger(70, { start: 120 }), ease: "out(4)",
  }), 1600);
}

export function resetResultsMotion() {
  results?.revert();
  results = undefined;
}

export function revealMode(element) {
  mode?.revert();
  if (reduceMotion.matches) return;
  mode = animate(element, { opacity: [0.4, 1], duration: 260, ease: "out(3)" });
}

function resetWave() {
  waveElement.removeAttribute("stroke-dasharray");
  waveElement.removeAttribute("stroke-dashoffset");
  waveElement.removeAttribute("pathLength");
}

function resetMotion() {
  entrance?.revert();
  ripple?.pause();
  rippleMap.setAttribute("scale", restingRipple);
  resetWave();
  youtubeIntro?.revert();
  mode?.revert();
  resetResultsMotion();
}

if (!hero.closest("[hidden]")) revealHero();
requestAnimationFrame(() => document.documentElement.classList.remove("motion-pending"));
reduceMotion.addEventListener("change", ({ matches }) => { if (matches) resetMotion(); });
addEventListener("pagehide", resetMotion);
