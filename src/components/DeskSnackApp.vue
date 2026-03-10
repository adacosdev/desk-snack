<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

// 25 ejercicios de peso corporal para snacks de movimiento
const EXERCISE_SNACKS = [
  'Sentadilla con salto y rodillas al pecho: 8-12 repeticiones.',
  'Flexión explosiva con despegue: 8-15 repeticiones.',
  'Posición de cuerpo hueco: 30-60 segundos.',
  'Sentadilla con salto explosivo: 10-15 repeticiones.',
  'Escalador de montaña con giro cruzado: 45-60 segundos.',
  'Sentadilla pistola (sobre una pierna): 5-8 por pierna.',
  'Flexión con rotación alternada: 6-10 repeticiones por lado.',
  'Rodillas altas en sprint: 45-60 segundos.',
  'Bicho muerto avanzado: 10-12 repeticiones por lado.',
  'Salto tucson (rodillas al pecho): 8-12 repeticiones.',
  'Sentadilla cosaca: 8-10 repeticiones por lado.',
  'Plancha lateral con elevación de pierna: 15-20 segundos por lado.',
  'Gusanito hasta flexión: 10-12 repeticiones.',
  'Mantener flexión isométrica: 30-45 segundos.',
  'Salto horizontal explosivo: 6-8 repeticiones.',
  'Giro ruso avanzado: 20-30 repeticiones total.',
  'Mantener posición L: 20-40 segundos.',
  'Estocada con salto alternado: 10-15 repeticiones por pierna.',
  'Gateada de oso hacia adelante y atrás: 45-60 segundos.',
  'Flexión explosiva con palmada: 6-10 repeticiones.',
  'Puente de glúteo sobre una pierna: 30-40 segundos por pierna.',
  'Burpee con salto horizontal explosivo: 6-8 repeticiones.',
  'Abdominales en declinación: 12-15 repeticiones.',
  'Estocada lateral con giro: 8-10 repeticiones por lado.',
  'Saltos alternados sobre una pierna: 20-30 saltos total.',
];

const STORAGE_KEYS = {
  theme: 'desk-snack:theme',
  sittingMinutes: 'desk-snack:sittingMinutes',
  standingMinutes: 'desk-snack:standingMinutes',
};

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

// Type definitions
interface WorkdaySession {
  startTime: number;
  sittingCycles: number;
  standingCycles: number;
  totalSittingSeconds: number;
  totalStandingSeconds: number;
  exercisesCompleted: string[];
}

type TimerState = 'idle' | 'sitting_active' | 'sitting_done' | 'standing_active' | 'standing_done' | 'paused';
type AppPhase = 'welcome' | 'active' | 'summary';

// Constants
const CIRCLE_LENGTH = 2 * Math.PI * 45;
const THEME_COLORS: Record<string, string> = { dark: '#0a0a0a', light: '#ffffff' };

// Utility functions
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

function getTodayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1; // Convert Sunday=0 to 6, Monday=1 to 0
}

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// Reactive state
const appPhase = ref<AppPhase>('welcome');
const currentSession = ref<WorkdaySession | null>(null);

// Timer state
const state = ref<TimerState>('idle');
const sittingMinutes = ref(loadNumber(STORAGE_KEYS.sittingMinutes, 40));
const standingMinutes = ref(loadNumber(STORAGE_KEYS.standingMinutes, 20));
const remainingSeconds = ref(0);
const totalSecondsForPhase = ref(0);
const pausedState = ref<TimerState | null>(null);
const currentSnack = ref<string | null>(null);
const settingsOpen = ref(false);
const endTime = ref(0);
const theme = ref<'dark' | 'light'>('dark');

let intervalId: ReturnType<typeof setInterval> | null = null;

// Setter functions for sitting/standing minutes
function setSittingMinutes(value: number) {
  sittingMinutes.value = value;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEYS.sittingMinutes, String(value));
}

function setStandingMinutes(value: number) {
  standingMinutes.value = value;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEYS.standingMinutes, String(value));
}

// Computed properties
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

const isSittingState = computed(() => {
  return (
    state.value === 'sitting_active' ||
    state.value === 'sitting_done' ||
    (state.value === 'paused' && pausedState.value === 'sitting_active')
  );
});

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

const themeButtonPressed = computed(() => theme.value === 'light');

// Timer functions
function tick() {
  if (state.value !== 'sitting_active' && state.value !== 'standing_active') return;
  const now = Date.now();
  const remaining = Math.max(0, Math.ceil((endTime.value - now) / 1000));
  remainingSeconds.value = remaining;

  // Accumulate time in session
  if (currentSession.value) {
    if (state.value === 'sitting_active') {
      currentSession.value.totalSittingSeconds = sittingMinutes.value * 60 - remaining;
    } else if (state.value === 'standing_active') {
      currentSession.value.totalStandingSeconds = standingMinutes.value * 60 - remaining;
    }
  }

  if (remaining <= 0) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (state.value === 'sitting_active') {
      setState('sitting_done');
    } else {
      setState('standing_done');
    }
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
}

function confirmTransition() {
  if (state.value === 'sitting_done') {
    if (currentSession.value && currentSnack.value) {
      currentSession.value.exercisesCompleted.push(currentSnack.value);
    }
    if (currentSession.value) {
      currentSession.value.standingCycles += 1;
    }
    totalSecondsForPhase.value = standingMinutes.value * 60;
    remainingSeconds.value = totalSecondsForPhase.value;
    endTime.value = Date.now() + remainingSeconds.value * 1000;
    setState('standing_active');
    startTick();
  } else if (state.value === 'standing_done') {
    if (currentSession.value) {
      currentSession.value.sittingCycles += 1;
    }
    totalSecondsForPhase.value = sittingMinutes.value * 60;
    remainingSeconds.value = totalSecondsForPhase.value;
    endTime.value = Date.now() + totalSecondsForPhase.value * 1000;
    setState('sitting_active');
    startTick();
  }
}

function onMainClick() {
  const action = mainButtonAction.value;
  if (action === 'start') start();
  else if (action === 'pause') pause();
  else if (action === 'resume') resume();
  else if (action === 'confirm') confirmTransition();
}

// App phase functions
function startWorkday() {
  if (!currentSession.value) {
    currentSession.value = {
      startTime: Date.now(),
      sittingCycles: 1, // First cycle starts immediately
      standingCycles: 0,
      totalSittingSeconds: 0,
      totalStandingSeconds: 0,
      exercisesCompleted: [],
    };
  }

  appPhase.value = 'active';
  start();
}

function endWorkday() {
  stopTick();
  stop();
  appPhase.value = 'summary';
}

function closeWorkday() {
  setState('idle');
  currentSession.value = null;
  appPhase.value = 'welcome';
}

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

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEYS.theme, next);
  applyTheme(next);
}

function openSettings() {
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
}

// Lifecycle
onMounted(() => {
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
  <!-- Welcome Phase -->
  <template v-if="appPhase === 'welcome'">
    <main id="app" class="app app-welcome">
      <div class="welcome-container">
        <!-- Header -->
        <div class="welcome-header">
          <h1 class="welcome-title">Jornada de Hoy</h1>
        </div>

        <!-- Today's Config Card -->
        <div class="today-config-card">
          <div class="today-day-name">{{ DAY_NAMES[getTodayIndex()] }}</div>
          
          <div class="config-block">
            <label for="welcome-sitting" class="config-label">Sentado</label>
            <div class="config-input-group">
              <input
                id="welcome-sitting"
                v-model.number="sittingMinutes"
                type="number"
                min="1"
                max="120"
                class="config-input"
                @change="setSittingMinutes($event.target.valueAsNumber)"
              />
              <span class="config-unit">min</span>
            </div>
          </div>

          <div class="config-block">
            <label for="welcome-standing" class="config-label">De pie</label>
            <div class="config-input-group">
              <input
                id="welcome-standing"
                v-model.number="standingMinutes"
                type="number"
                min="1"
                max="60"
                class="config-input"
                @change="setStandingMinutes($event.target.valueAsNumber)"
              />
              <span class="config-unit">min</span>
            </div>
          </div>
        </div>

        <!-- Start Workday Button -->
        <div class="welcome-actions">
          <button type="button" class="btn-start-workday" @click="startWorkday">
            Iniciar Jornada
          </button>
          <button type="button" class="btn-settings-welcome" aria-label="Configuración" @click="openSettings">
            <svg class="icon-gear" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
            </svg>
          </button>
        </div>
      </div>
    </main>
  </template>

  <!-- Active Phase -->
  <template v-else-if="appPhase === 'active'">
    <main id="app" class="app" :data-state="state">
      <div class="screen-main">
        <div class="state-icon" aria-hidden="true">
          <!-- Sentado — estilo SF Symbols (figure.seated / chair) -->
          <svg v-if="isSittingState" class="icon-state icon-apple" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 20V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11" />
            <path d="M6 14h12" />
            <path d="M8 14V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v7" />
          </svg>
          <!-- De pie — estilo SF Symbols (figure.stand) -->
          <svg v-else class="icon-state icon-apple" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="5" r="2.5" />
            <path d="M12 8.5v7" />
            <path d="M12 15.5l-3.5 5.5" />
            <path d="M12 15.5l3.5 5.5" />
            <path d="M8.5 11h7" />
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
            <button type="button" class="btn-icon btn-icon-secondary" aria-label="Finalizar jornada" @click="endWorkday">
              <svg class="icon-btn" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            </button>
          </template>
        </div>
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
            <!-- De pie (overlay cuando toca levantarse) -->
            <svg v-if="state === 'sitting_done'" class="icon-overlay icon-apple" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="2.5" />
              <path d="M12 8.5v7" />
              <path d="M12 15.5l-3.5 5.5" />
              <path d="M12 15.5l3.5 5.5" />
              <path d="M8.5 11h7" />
            </svg>
            <!-- Sentado (overlay cuando toca sentarse) -->
            <svg v-else class="icon-overlay icon-apple" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 20V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11" />
              <path d="M6 14h12" />
              <path d="M8 14V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v7" />
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
  </template>

  <!-- Summary Phase -->
  <template v-else-if="appPhase === 'summary'">
    <main id="app" class="app app-summary">
      <div class="summary-container">
        <!-- Header -->
        <div class="summary-header">
          <h1 class="summary-title">Resumen de Jornada</h1>
        </div>

        <!-- Stats Cards -->
        <div class="stats-grid" v-if="currentSession">
          <div class="stat-card">
            <div class="stat-label">Tiempo Total</div>
            <div class="stat-value">
              {{ formatSeconds(Math.floor((Date.now() - currentSession.startTime) / 1000)) }}
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Ciclos Sentados</div>
            <div class="stat-value">{{ currentSession.sittingCycles }}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Ciclos de Pie</div>
            <div class="stat-value">{{ currentSession.standingCycles }}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Tiempo Sentado</div>
            <div class="stat-value">{{ formatSeconds(currentSession.totalSittingSeconds) }}</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Tiempo de Pie</div>
            <div class="stat-value">{{ formatSeconds(currentSession.totalStandingSeconds) }}</div>
          </div>
        </div>

        <!-- Exercises Completed -->
        <div class="exercises-section" v-if="currentSession && currentSession.exercisesCompleted.length > 0">
          <h2 class="exercises-title">Ejercicios Completados</h2>
          <ul class="exercises-list">
            <li v-for="(exercise, index) in currentSession.exercisesCompleted" :key="index" class="exercise-item">
              {{ exercise }}
            </li>
          </ul>
        </div>

        <!-- Close Button -->
        <button type="button" class="btn-close-summary" @click="closeWorkday">
          Cerrar
        </button>
      </div>
    </main>
  </template>

  <!-- Settings Sheet -->
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
      <h2 class="sheet-title">CONFIGURACIÓN</h2>

      <div class="sheet-actions">
        <button
          id="btn-theme"
          type="button"
          class="toggle-theme toggle-theme-icon"
          :aria-pressed="themeButtonPressed"
          aria-label="Cambiar tema"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" class="icon-setting" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          <svg v-else class="icon-setting" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
    </div>
  </div>

</template>

<style scoped>
/* Welcome Phase Styles */
.app-welcome {
  background: var(--bg);
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.welcome-container {
  width: 100%;
  max-width: 360px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.welcome-header {
  text-align: center;
}

.welcome-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  margin: 0;
}

.today-config-card {
   background: var(--surface);
   border-radius: var(--radius-lg);
   padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-sm);
}

.today-day-name {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
  text-transform: uppercase;
}

.config-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.config-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
}

.config-input:focus {
  outline: none;
  border-color: #FCD34D;
}

.config-unit {
  font-size: 13px;
  color: var(--muted);
  font-weight: 500;
}

.welcome-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
}

.btn-start-workday {
  flex: 1;
  min-height: 50px;
  padding: 0 24px;
  background: #FCD34D;
  color: #000000;
  border: none;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 17px;
  cursor: pointer;
  transition: all 0.2s;
  touch-action: manipulation;
}

.btn-start-workday:hover {
  opacity: 0.9;
}

.btn-start-workday:active {
  transform: scale(0.97);
}

.btn-settings-welcome {
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius);
  background: var(--fill-tertiary);
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-settings-welcome:active {
  transform: scale(0.96);
}

/* Summary Phase Styles */
.app-summary {
  background: var(--bg);
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.summary-container {
  width: 100%;
  max-width: 360px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-header {
  text-align: center;
}

.summary-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.stat-card {
   background: var(--surface);
   border-radius: var(--radius-lg);
   padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: var(--shadow-sm);
  text-align: center;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
}

.exercises-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.exercises-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.exercises-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.exercise-item {
  background: var(--fill-tertiary);
  padding: 12px;
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
}

.btn-close-summary {
  min-height: 50px;
  padding: 0 24px;
  background: #FCD34D;
  color: #000000;
  border: none;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 17px;
  cursor: pointer;
  transition: all 0.2s;
  touch-action: manipulation;
}

.btn-close-summary:hover {
  opacity: 0.9;
}

.btn-close-summary:active {
  transform: scale(0.97);
}

/* Settings Sheet */
.sheet {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 1.5rem 1.5rem;
  padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
  pointer-events: none;
}

.sheet[hidden] {
  display: none;
}

.sheet--open {
  pointer-events: auto;
}

.sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  cursor: pointer;
}

.sheet-panel {
  position: relative;
  width: 100%;
  max-width: 480px;
  background: var(--dim);
  backdrop-filter: saturate(180%) blur(40px);
  -webkit-backdrop-filter: saturate(180%) blur(40px);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 24px 20px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
   animation: sheetSlideUp 0.4s var(--ease) forwards;
}

@keyframes sheetSlideUp {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sheet-handle {
  width: 40px;
  height: 5px;
  background: var(--fill-quaternary);
  border-radius: 2.5px;
  margin: 0 auto 20px;
}

.sheet-title {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
}

.sheet-settings {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 20px;
}

.settings-item {
   display: flex;
   align-items: center;
   justify-content: space-between;
   padding: 16px 0;
   border-bottom: 1px solid var(--border);
   background: transparent;
  border: none;
  color: var(--text);
  cursor: pointer;
  font-size: 17px;
  text-align: left;
  transition: all 0.2s;
}

.settings-item:last-child {
  border-bottom: none;
}

.settings-item:active {
  opacity: 0.7;
}

.sheet-actions {
   display: flex;
   gap: 12px;
   border-top: 1px solid var(--border);
   padding-top: 16px;
  margin-top: 16px;
}

.toggle-theme-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: var(--fill-tertiary);
  border: none;
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-theme-icon:active {
  transform: scale(0.96);
}
</style>
