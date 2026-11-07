import { animate, createDrawable, createTimeline, stagger } from "./vendor/anime-4.5.0.mjs";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const waveElement = document.querySelector("[data-wave]");
const hero = document.querySelector(".hero");
let entrance;
let results;
let mode;
let youtubeIntro;

// Content must never stay hidden: if frames stop (background tab, throttled
// pane), finish the entrance on a timer instead of waiting for rAF.
function settle(animation, ms) {
  setTimeout(() => { if (!animation.completed) animation.complete(); }, ms);
  return animation;
}

export function revealHero(first = false) {
  entrance?.revert();
  if (reduceMotion.matches) return;
  entrance = createTimeline({ defaults: { ease: "out(4)" } })
    .add(hero.querySelectorAll("#headline .line > span"), {
      opacity: [0, 1], y: ["0.45em", "0em"], filter: ["blur(10px)", "blur(0px)"], duration: 760, delay: stagger(90),
    }, 0)
    .add(hero.querySelectorAll(".eyebrow, .intro"), { opacity: [0, 1], y: [10, 0], duration: 520, delay: stagger(60) }, 80);
  if (first) {
    entrance
      .add(hero.querySelector(".upload"), { opacity: [0, 1], y: [24, 0], duration: 760 }, 180)
      .add(hero.querySelector(".app"), { opacity: [0, 1], y: [70, 0], scale: [.96, 1], duration: 1100, ease: "out(5)" }, 300);
  }
  settle(entrance, 1900);
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
    opacity: [0, 1], y: [20, 0], duration: 600, delay: stagger(70), ease: "out(4)",
  }), 1400);
}

export function revealResults(elements) {
  resetResultsMotion();
  if (reduceMotion.matches) return;
  results = settle(animate(elements, {
    opacity: [0, 1], x: [-14, 0], duration: 520, delay: stagger(70, { start: 120 }), ease: "out(4)",
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
  resetWave();
  youtubeIntro?.revert();
  mode?.revert();
  resetResultsMotion();
}

if (!hero.closest("[hidden]")) revealHero(true);
requestAnimationFrame(() => document.documentElement.classList.remove("motion-pending"));
reduceMotion.addEventListener("change", ({ matches }) => { if (matches) resetMotion(); });
addEventListener("pagehide", resetMotion);
