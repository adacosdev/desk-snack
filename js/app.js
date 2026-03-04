if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const EXERCISE_SNACKS = [
  'Haz 15 sentadillas.',
  'Estira los brazos hacia el techo durante 30 segundos.',
  'Haz 20 elevaciones de gemelos (ponte de puntillas).',
  'Haz 10 flexiones en la pared o en la mesa.',
  'Gira el torso de lado a lado 10 veces.',
  'Haz rotaciones de cuello y hombros durante 1 minuto.',
];

const STORAGE_KEYS = {
  sittingMinutes: 'desk-snack:sittingMinutes',
  standingMinutes: 'desk-snack:standingMinutes',
};

const CIRCLE_LENGTH = 2 * Math.PI * 45;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class TimerApp {
  constructor() {
    this.state = 'idle';
    this.sittingMinutes = this.loadNumber(STORAGE_KEYS.sittingMinutes, 25);
    this.standingMinutes = this.loadNumber(STORAGE_KEYS.standingMinutes, 5);
    this.remainingSeconds = 0;
    this.totalSecondsForPhase = 0;
    this.intervalId = null;
    this.endTime = null;
    this.pausedState = null;
    this.onStateChange = null;
  }

  loadNumber(key, fallback) {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  saveConfig() {
    localStorage.setItem(STORAGE_KEYS.sittingMinutes, String(this.sittingMinutes));
    localStorage.setItem(STORAGE_KEYS.standingMinutes, String(this.standingMinutes));
  }

  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange?.(this);
  }

  start() {
    if (this.state !== 'idle' && this.state !== 'standing_done') return;
    this.pausedState = null;
    this.totalSecondsForPhase = this.sittingMinutes * 60;
    this.remainingSeconds = this.totalSecondsForPhase;
    this.endTime = Date.now() + this.remainingSeconds * 1000;
    this.setState('sitting_active');
    this.startTick();
  }

  startTick() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), 200);
  }

  stopTick() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  tick() {
    if (this.state !== 'sitting_active' && this.state !== 'standing_active') return;
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((this.endTime - now) / 1000));
    this.remainingSeconds = remaining;
    this.onStateChange?.(this);
    if (remaining <= 0) {
      this.stopTick();
      if (this.state === 'sitting_active') this.setState('sitting_done');
      else this.setState('standing_done');
    }
  }

  pause() {
    if (this.state !== 'sitting_active' && this.state !== 'standing_active') return;
    this.pausedState = this.state;
    this.stopTick();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.pausedState) return;
    this.endTime = Date.now() + this.remainingSeconds * 1000;
    this.setState(this.pausedState);
    this.startTick();
  }

  confirmTransition() {
    if (this.state === 'sitting_done') {
      this.totalSecondsForPhase = this.standingMinutes * 60;
      this.remainingSeconds = this.totalSecondsForPhase;
      this.endTime = Date.now() + this.remainingSeconds * 1000;
      this.setState('standing_active');
      this.startTick();
    } else if (this.state === 'standing_done') {
      this.totalSecondsForPhase = this.sittingMinutes * 60;
      this.remainingSeconds = this.totalSecondsForPhase;
      this.endTime = Date.now() + this.remainingSeconds * 1000;
      this.setState('sitting_active');
      this.startTick();
    }
  }

  getSnack() {
    return pickRandom(EXERCISE_SNACKS);
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  progressRatio() {
    if (this.totalSecondsForPhase <= 0) return 1;
    return this.remainingSeconds / this.totalSecondsForPhase;
  }
}

function initProgressRing() {
  const progressEl = document.getElementById('timer-progress');
  if (progressEl) progressEl.style.strokeDasharray = CIRCLE_LENGTH;
}

const timerApp = new TimerApp();

function render(state) {
  const labelEl = document.getElementById('state-label');
  const displayEl = document.getElementById('timer-display');
  const progressEl = document.getElementById('timer-progress');
  const btnEl = document.getElementById('btn-main');

  if (!labelEl || !displayEl || !progressEl || !btnEl) return;

  const isSitting = state.state === 'sitting_active' || state.state === 'sitting_done' || (state.state === 'paused' && state.pausedState === 'sitting_active');
  labelEl.textContent = state.state === 'idle' ? '—' : isSitting ? 'Sentado' : 'De pie';

  displayEl.textContent = state.formatTime(state.remainingSeconds);

  const ratio = state.progressRatio();
  progressEl.style.strokeDashoffset = (1 - ratio) * CIRCLE_LENGTH;

  if (state.state === 'idle' || state.state === 'standing_done') {
    btnEl.textContent = 'Iniciar';
    btnEl.dataset.action = 'start';
  } else if (state.state === 'sitting_done') {
    btnEl.textContent = 'Ya estoy de pie!';
    btnEl.dataset.action = 'confirm';
  } else if (state.state === 'standing_done') {
    btnEl.textContent = 'Ya me he sentado!';
    btnEl.dataset.action = 'confirm';
  } else if (state.state === 'paused') {
    btnEl.textContent = 'Reanudar';
    btnEl.dataset.action = 'resume';
  } else {
    btnEl.textContent = 'Pausar';
    btnEl.dataset.action = 'pause';
  }
}

timerApp.onStateChange = render;

document.addEventListener('DOMContentLoaded', () => {
  initProgressRing();
  render(timerApp);

  document.getElementById('btn-main')?.addEventListener('click', () => {
    const action = document.getElementById('btn-main')?.dataset.action;
    if (action === 'start') timerApp.start();
    else if (action === 'pause') timerApp.pause();
    else if (action === 'resume') timerApp.resume();
    else if (action === 'confirm') timerApp.confirmTransition();
  });
});
