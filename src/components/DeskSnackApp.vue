<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

// Snacks de fuerza para trabajo sentado (basados en recomendaciones para oficina)
const EXERCISE_SNACKS = [
  'Fondos en silla (apóyate en reposabrazos, 10 repeticiones).',
  'Sentadillas desde la silla: 15 repeticiones.',
  'Flexiones en la pared: 10 repeticiones.',
  'Elevaciones de gemelos (de puntillas): 20 repeticiones.',
  'Plancha en el escritorio (apoyo en mesa, 20 segundos).',
  'Giro de torso sentado: 10 veces cada lado.',
  'Fondos de tríceps en silla: 10 repeticiones.',
  'Sentadilla contra la pared (wall sit): 20 segundos.',
  'Elevaciones de pierna sentado (cuádriceps): 12 por pierna.',
  'Asentimientos de cabeza (fortalecer cuello): 10 repeticiones.',
  'Marcha elevando rodillas: 30 segundos.',
  'Desplantes alternos: 8 por pierna.',
];

const STORAGE_KEYS = {
  sittingMinutes: 'desk-snack:sittingMinutes',
  standingMinutes: 'desk-snack:standingMinutes',
  theme: 'desk-snack:theme',
};

const THEME_COLORS: Record<string, string> = { dark: '#0f172a', light: '#f8fafc' };
const CIRCLE_LENGTH = 2 * Math.PI * 45;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // ignore
  }
}

function vibrateAlert() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

function loadNumber(key: string, fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

type TimerState = 'idle' | 'sitting_active' | 'sitting_done' | 'standing_active' | 'standing_done' | 'paused';

const state = ref<TimerState>('idle');
const sittingMinutes = ref(40);
const standingMinutes = ref(20);
const remainingSeconds = ref(0);
const totalSecondsForPhase = ref(0);
const pausedState = ref<TimerState | null>(null);
const currentSnack = ref<string | null>(null);
const settingsOpen = ref(false);
const endTime = ref(0);
const theme = ref<'dark' | 'light'>('dark');
let intervalId: ReturnType<typeof setInterval> | null = null;

function saveConfig() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.sittingMinutes, String(sittingMinutes.value));
  localStorage.setItem(STORAGE_KEYS.standingMinutes, String(standingMinutes.value));
}

function setState(newState: TimerState) {
  if (state.value === newState) return;
  state.value = newState;
  if (newState === 'sitting_done') {
    currentSnack.value = pickRandom(EXERCISE_SNACKS);
    playAlertSound();
    vibrateAlert();
  } else if (newState === 'standing_done') {
    currentSnack.value = null;
    playAlertSound();
    vibrateAlert();
  }
}

function tick() {
  if (state.value !== 'sitting_active' && state.value !== 'standing_active') return;
  const now = Date.now();
  const remaining = Math.max(0, Math.ceil((endTime.value - now) / 1000));
  remainingSeconds.value = remaining;
  if (remaining <= 0) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (state.value === 'sitting_active') setState('sitting_done');
    else setState('standing_done');
  }
}

function startTick() {
  if (intervalId) return;
  intervalId = setInterval(tick, 200);
}

function stopTick() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function start() {
  if (state.value !== 'idle' && state.value !== 'standing_done') return;
  pausedState.value = null;
  totalSecondsForPhase.value = sittingMinutes.value * 60;
  remainingSeconds.value = totalSecondsForPhase.value;
  endTime.value = Date.now() + remainingSeconds.value * 1000;
  setState('sitting_active');
  startTick();
}

function pause() {
  if (state.value !== 'sitting_active' && state.value !== 'standing_active') return;
  pausedState.value = state.value;
  stopTick();
  setState('paused');
}

function resume() {
  if (state.value !== 'paused' || !pausedState.value) return;
  endTime.value = Date.now() + remainingSeconds.value * 1000;
  setState(pausedState.value);
  startTick();
}

function stop() {
  if (state.value === 'idle') return;
  stopTick();
  setState('idle');
}

function restart() {
  if (state.value !== 'sitting_active' && state.value !== 'standing_active' && state.value !== 'paused') return;
  const phaseMinutes = state.value === 'standing_active' || (state.value === 'paused' && pausedState.value === 'standing_active')
    ? standingMinutes.value
    : sittingMinutes.value;
  totalSecondsForPhase.value = phaseMinutes * 60;
  remainingSeconds.value = totalSecondsForPhase.value;
  endTime.value = Date.now() + totalSecondsForPhase.value * 1000;
  if (state.value === 'paused') {
    setState(pausedState.value!);
    startTick();
  }
  // else already ticking, just updated endTime/remaining
}

function confirmTransition() {
  if (state.value === 'sitting_done') {
    totalSecondsForPhase.value = standingMinutes.value * 60;
    remainingSeconds.value = totalSecondsForPhase.value;
    endTime.value = Date.now() + remainingSeconds.value * 1000;
    setState('standing_active');
    startTick();
  } else if (state.value === 'standing_done') {
    totalSecondsForPhase.value = sittingMinutes.value * 60;
    remainingSeconds.value = totalSecondsForPhase.value;
    endTime.value = Date.now() + remainingSeconds.value * 1000;
    setState('sitting_active');
    startTick();
  }
}

const isSittingState = computed(() => {
  return (
    state.value === 'sitting_active' ||
    state.value === 'sitting_done' ||
    (state.value === 'paused' && pausedState.value === 'sitting_active')
  );
});

const displayTime = computed(() => {
  const s = remainingSeconds.value;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
});

const progressRatio = computed(() => {
  if (totalSecondsForPhase.value <= 0) return 1;
  return remainingSeconds.value / totalSecondsForPhase.value;
});

const progressOffset = computed(() => (1 - progressRatio.value) * CIRCLE_LENGTH);

const mainButtonAction = computed(() => {
  if (state.value === 'idle' || state.value === 'standing_done') return 'start';
  if (state.value === 'sitting_done') return 'confirm';
  if (state.value === 'paused') return 'resume';
  return 'pause';
});

const showStopRestart = computed(
  () =>
    state.value === 'sitting_active' ||
    state.value === 'standing_active' ||
    state.value === 'paused'
);

function onMainClick() {
  const action = mainButtonAction.value;
  if (action === 'start') start();
  else if (action === 'pause') pause();
  else if (action === 'resume') resume();
  else if (action === 'confirm') confirmTransition();
}

const overlayVisible = computed(
  () => state.value === 'sitting_done' || state.value === 'standing_done'
);

const overlayTitle = computed(() =>
  state.value === 'sitting_done' ? '¡Hora de levantarte!' : '¡Hora de sentarte!'
);

const confirmButtonText = computed(() =>
  state.value === 'sitting_done' ? '¡Ya estoy de pie!' : '¡Ya me he sentado!'
);

const showSnackCard = computed(
  () => state.value === 'sitting_done' && currentSnack.value !== null
);

function applyTheme(value: string) {
  const resolved =
    value ||
    (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  const nextTheme = (resolved === 'dark' ? 'dark' : 'light') as 'dark' | 'light';
  theme.value = nextTheme;
  const root = document.documentElement;
  root.dataset.theme = nextTheme;
  const metaTheme = document.getElementById('meta-theme-color');
  if (metaTheme)
    metaTheme.setAttribute('content', THEME_COLORS[nextTheme] ?? THEME_COLORS.dark);
}

const themeButtonPressed = computed(() => theme.value === 'light');

function openSettings() {
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
}

function updateSittingMinutes(val: number) {
  const v = Number.isFinite(val) ? Math.max(1, Math.min(120, val)) : 25;
  sittingMinutes.value = v;
  saveConfig();
}

function updateStandingMinutes(val: number) {
  const v = Number.isFinite(val) ? Math.max(1, Math.min(60, val)) : 5;
  standingMinutes.value = v;
  saveConfig();
}

function resetSettings() {
  sittingMinutes.value = 25;
  standingMinutes.value = 5;
  saveConfig();
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEYS.theme, next);
  applyTheme(next);
}

onMounted(() => {
  sittingMinutes.value = loadNumber(STORAGE_KEYS.sittingMinutes, 25);
  standingMinutes.value = loadNumber(STORAGE_KEYS.standingMinutes, 5);
  const savedTheme =
    typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.theme) : null;
  const resolved =
    savedTheme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  theme.value = resolved === 'dark' ? 'dark' : 'light';
  applyTheme(savedTheme ?? '');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});

onUnmounted(() => {
  stopTick();
});
</script>

<template>
  <main id="app" class="app" :data-state="state">
    <div class="screen-main">
      <div class="state-icon" aria-hidden="true">
        <!-- Chair (sentado) -->
        <svg v-if="isSittingState" class="icon-state" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 20v-8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8" />
          <path d="M5 12h14" />
          <path d="M7 12v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" />
        </svg>
        <!-- Person standing (de pie) -->
        <svg v-else class="icon-state" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2" />
          <path d="M12 22v-4" />
          <path d="M12 18a4 4 0 0 0 4-4V9a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4z" />
        </svg>
      </div>
      <div class="timer-ring" aria-hidden="true">
        <svg viewBox="0 0 100 100" class="timer-svg">
          <circle class="timer-bg" cx="50" cy="50" r="45" />
          <circle
            class="timer-progress"
            cx="50"
            cy="50"
            r="45"
            :style="{ strokeDasharray: CIRCLE_LENGTH, strokeDashoffset: progressOffset }"
          />
        </svg>
        <span class="timer-display" aria-live="polite" aria-atomic="true">{{ displayTime }}</span>
      </div>
      <div class="actions-row">
        <button
          type="button"
          class="btn-primary btn-icon"
          :aria-label="mainButtonAction === 'start' ? 'Iniciar' : mainButtonAction === 'pause' ? 'Pausar' : mainButtonAction === 'resume' ? 'Reanudar' : 'Confirmar'"
          @click="onMainClick"
        >
          <template v-if="mainButtonAction === 'start'">
            <svg class="icon-btn" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </template>
          <template v-else-if="mainButtonAction === 'pause'">
            <svg class="icon-btn" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </template>
          <template v-else-if="mainButtonAction === 'resume'">
            <svg class="icon-btn" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </template>
          <template v-else>
            <svg class="icon-btn" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
          </template>
        </button>
        <template v-if="showStopRestart">
          <button type="button" class="btn-icon btn-icon-secondary" aria-label="Reiniciar fase" @click="restart">
            <svg class="icon-btn" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
          <button type="button" class="btn-icon btn-icon-secondary" aria-label="Parar" @click="stop">
            <svg class="icon-btn" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
          </button>
        </template>
      </div>
      <button type="button" class="btn-settings" aria-label="Configuración" @click="openSettings">
        <svg class="icon-gear" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
        </svg>
      </button>
    </div>

    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="overlayVisible ? 'alert-title' : undefined"
      :hidden="!overlayVisible"
    >
      <div class="overlay-backdrop" aria-hidden="true" />
      <div class="overlay-content">
        <h2 id="alert-title" class="overlay-title visually-hidden">{{ overlayTitle }}</h2>
        <div class="overlay-icon" aria-hidden="true">
          <svg v-if="state === 'sitting_done'" class="icon-overlay" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22v-4"/><path d="M12 18a4 4 0 0 0 4-4V9a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4z"/><circle cx="12" cy="5" r="2"/>
          </svg>
          <svg v-else class="icon-overlay" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 20v-8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8"/><path d="M5 12h14"/><path d="M7 12v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/>
          </svg>
        </div>
        <div class="snack-card" :hidden="!showSnackCard">
          <p class="snack-text">{{ currentSnack }}</p>
        </div>
        <button type="button" class="btn-confirm btn-confirm-icon" :aria-label="confirmButtonText" @click="confirmTransition">
          <svg class="icon-btn" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
      </div>
    </div>
  </main>

  <div
    class="sheet"
    aria-modal="true"
    aria-label="Configuración"
    :aria-hidden="!settingsOpen"
    :hidden="!settingsOpen"
    :class="{ 'sheet--open': settingsOpen }"
  >
    <div class="sheet-backdrop" aria-hidden="true" @click="closeSettings" />
    <div class="sheet-panel">
      <div class="sheet-handle" aria-hidden="true" />
      <div class="setting-row setting-row-input">
        <label for="sitting-min" class="setting-label-icon">
          <svg class="icon-setting" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 20v-8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8"/><path d="M5 12h14"/><path d="M7 12v-3a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3"/></svg>
        </label>
        <input
          id="sitting-min"
          v-model.number="sittingMinutes"
          type="number"
          min="1"
          max="120"
          class="input-minutes"
          @change="updateSittingMinutes(sittingMinutes)"
        />
        <span class="setting-unit">min</span>
      </div>
      <div class="setting-row setting-row-input">
        <label for="standing-min" class="setting-label-icon">
          <svg class="icon-setting" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><path d="M12 22v-4"/><path d="M12 18a4 4 0 0 0 4-4V9a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4z"/></svg>
        </label>
        <input
          id="standing-min"
          v-model.number="standingMinutes"
          type="number"
          min="1"
          max="60"
          class="input-minutes"
          @change="updateStandingMinutes(standingMinutes)"
        />
        <span class="setting-unit">min</span>
      </div>
      <div class="setting-row setting-row-toggle">
        <button
          id="btn-theme"
          type="button"
          class="toggle-theme toggle-theme-icon"
          :aria-pressed="themeButtonPressed"
          aria-label="Cambiar tema"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" class="icon-setting" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          <svg v-else class="icon-setting" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
      <button type="button" class="btn-secondary btn-icon-reset" aria-label="Restablecer valores" @click="resetSettings">
        <svg class="icon-btn" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    </div>
  </div>
</template>
