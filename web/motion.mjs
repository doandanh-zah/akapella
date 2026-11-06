import { animate, createDrawable, createTimeline, stagger } from "./vendor/anime-4.5.0.mjs";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let entrance;
let results;
let mode;
let youtubeIntro;
const waveElement = document.querySelector("[data-wave]");

if (!reduceMotion.matches) {
  const hero = document.querySelector(".hero");
  const wave = createDrawable(waveElement);
  entrance = createTimeline({ defaults: { ease: "out(4)" }, onComplete: resetWave })
    .add(hero.querySelectorAll("[data-hero]"), {
      opacity: [0.55, 1], y: [18, 0], duration: 460, delay: stagger(75),
    }, 0)
    .add(hero.querySelector(".signal"), {
      opacity: [0.55, 1], x: [14, 0], duration: 470,
    }, 100)
    .add(wave, { draw: ["0 0", "0 1"], duration: 730 }, 180);
}

const youtube = document.querySelector(".youtube-intro");
const observer = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  observer.disconnect();
  if (reduceMotion.matches) return;
  youtubeIntro = animate(youtube, { opacity: [0.62, 1], y: [10, 0], duration: 340, ease: "out(3)" });
}, { threshold: 0.4 });
if (!reduceMotion.matches) observer.observe(youtube);

export function revealResults(elements) {
  resetResultsMotion();
  if (reduceMotion.matches) return;
  results = animate(elements, {
    opacity: [0.5, 1], y: [12, 0], duration: 330, delay: stagger(38), ease: "out(4)",
  });
}

export function resetResultsMotion() {
  results?.revert();
  results = undefined;
}

export function revealMode(element) {
  mode?.revert();
  if (reduceMotion.matches) return;
  mode = animate(element, { opacity: [0.5, 1], duration: 220, ease: "out(3)" });
}

function resetWave() {
  waveElement.removeAttribute("stroke-dasharray");
  waveElement.removeAttribute("stroke-dashoffset");
  waveElement.removeAttribute("pathLength");
}

function resetMotion() {
  observer.disconnect();
  entrance?.revert();
  resetWave();
  youtubeIntro?.revert();
  mode?.revert();
  resetResultsMotion();
}
reduceMotion.addEventListener("change", ({ matches }) => { if (matches) resetMotion(); });
addEventListener("pagehide", resetMotion);
