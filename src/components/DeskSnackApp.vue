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
  workSchedule: 'desk-snack:workSchedule',
};

interface DaySchedule {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
}

interface DayOverride extends Partial<DaySchedule> {
  enabled?: boolean;
}

interface WorkSchedule {
  default: DaySchedule;
  overrides: Partial<Record<number, DayOverride>>;
}

function parseTime24(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return {
    h: Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 0,
    m: Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0,
  };
}

function formatTime24(h: number, m: number): string {
  return `${String(Math.max(0, Math.min(23, h))).padStart(2, '0')}:${String(Math.max(0, Math.min(59, m))).padStart(2, '0')}`;
}

const DEFAULT_DAY_SCHEDULE: DaySchedule = {
  morningStart: '09:00',
  morningEnd: '13:00',
  afternoonStart: '15:00',
  afternoonEnd: '18:00',
};

const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  default: { ...DEFAULT_DAY_SCHEDULE },
  overrides: {},
};

function loadWorkSchedule(): WorkSchedule {
  if (typeof localStorage === 'undefined') return DEFAULT_WORK_SCHEDULE;
  const raw = localStorage.getItem(STORAGE_KEYS.workSchedule);
  if (!raw) return DEFAULT_WORK_SCHEDULE;
  try {
    const parsed = JSON.parse(raw) as WorkSchedule;
    if (!parsed?.default) return DEFAULT_WORK_SCHEDULE;
    return {
      default: { ...DEFAULT_DAY_SCHEDULE, ...parsed.default },
      overrides: parsed.overrides ?? {},
    };
  } catch {
    return DEFAULT_WORK_SCHEDULE;
  }
}

function saveWorkSchedule(schedule: WorkSchedule) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.workSchedule, JSON.stringify(schedule));
}

const THEME_COLORS: Record<string, string> = { dark: '#000000', light: '#f2f2f7' };
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
const workSchedule = ref<WorkSchedule>({ ...DEFAULT_WORK_SCHEDULE });
const scheduleCheckTime = ref(Date.now());
const expandedScheduleDay = ref<number | null>(null);
let intervalId: ReturnType<typeof setInterval> | null = null;
let scheduleTickId: ReturnType<typeof setInterval> | null = null;

function saveConfig() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.sittingMinutes, String(sittingMinutes.value));
  localStorage.setItem(STORAGE_KEYS.standingMinutes, String(standingMinutes.value));
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;

function isDayEnabled(day: number): boolean {
  const override = workSchedule.value.overrides[day];
  if (override && typeof override.enabled === 'boolean') return override.enabled;
  return true;
}

function getScheduleForDay(day: number): DaySchedule {
  const base = workSchedule.value.default;
  const override = workSchedule.value.overrides[day];
  if (!override) return base;
  const { enabled: _e, ...times } = override;
  return { ...base, ...times };
}

function getTodaySchedule(): DaySchedule {
  return getScheduleForDay(new Date().getDay());
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isWithinWorkWindow(now?: Date): boolean {
  const t = now ?? new Date();
  const day = t.getDay();
  if (!isDayEnabled(day)) return false;
  const s = getScheduleForDay(day);
  const nowM = t.getHours() * 60 + t.getMinutes();
  const morningStart = timeToMinutes(s.morningStart);
  const morningEnd = timeToMinutes(s.morningEnd);
  if (nowM >= morningStart && nowM < morningEnd) return true;
  const afternoonStart = timeToMinutes(s.afternoonStart);
  const afternoonEnd = timeToMinutes(s.afternoonEnd);
  if (afternoonStart < afternoonEnd && nowM >= afternoonStart && nowM < afternoonEnd) return true;
  return false;
}

const isWithinWorkSchedule = computed(() => {
  scheduleCheckTime.value;
  return isWithinWorkWindow();
});

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

function updateSchedule() {
  saveWorkSchedule(workSchedule.value);
}

function setDayOverride(day: number, field: keyof DaySchedule, value: string) {
  const prev = workSchedule.value.overrides[day];
  const next: DayOverride = { ...prev, [field]: value };
  workSchedule.value = {
    ...workSchedule.value,
    overrides: { ...workSchedule.value.overrides, [day]: next },
  };
  saveWorkSchedule(workSchedule.value);
}

function setDayEnabled(day: number, enabled: boolean) {
  const prev = workSchedule.value.overrides[day];
  const next: DayOverride = { ...prev, enabled };
  workSchedule.value = {
    ...workSchedule.value,
    overrides: { ...workSchedule.value.overrides, [day]: next },
  };
  saveWorkSchedule(workSchedule.value);
}

function clearDayOverride(day: number) {
  const { [day]: _, ...rest } = workSchedule.value.overrides;
  workSchedule.value = { ...workSchedule.value, overrides: rest };
  saveWorkSchedule(workSchedule.value);
  expandedScheduleDay.value = null;
}

function setDefaultTime(field: keyof DaySchedule, h: number, m: number) {
  workSchedule.value.default[field] = formatTime24(h, m);
  saveWorkSchedule(workSchedule.value);
}

function setDayOverrideTime(day: number, field: keyof DaySchedule, h: number, m: number) {
  setDayOverride(day, field, formatTime24(h, m));
}

function resetSettings() {
  sittingMinutes.value = 25;
  standingMinutes.value = 5;
  workSchedule.value = { ...DEFAULT_WORK_SCHEDULE };
  saveConfig();
  saveWorkSchedule(workSchedule.value);
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
  workSchedule.value = loadWorkSchedule();
  const savedTheme =
    typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.theme) : null;
  const resolved =
    savedTheme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  theme.value = resolved === 'dark' ? 'dark' : 'light';
  applyTheme(savedTheme ?? '');

  scheduleTickId = setInterval(() => {
    scheduleCheckTime.value = Date.now();
  }, 60_000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});

onUnmounted(() => {
  stopTick();
  if (scheduleTickId) {
    clearInterval(scheduleTickId);
    scheduleTickId = null;
  }
});
</script>

<template>
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
      <div class="schedule-badge" :class="{ 'schedule-badge--in': isWithinWorkSchedule, 'schedule-badge--out': !isWithinWorkSchedule }" aria-live="polite" :aria-label="isWithinWorkSchedule ? 'Dentro de jornada' : 'Fuera de jornada'">
        <svg class="icon-schedule" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
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

      <div class="sheet-settings">
        <div class="setting-block">
          <label for="sitting-min" class="setting-block-label">
            <svg class="icon-setting icon-apple" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11"/><path d="M6 14h12"/><path d="M8 14V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v7"/></svg>
            <span>Sentado</span>
          </label>
          <div class="setting-block-input">
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
        </div>

        <div class="setting-block">
          <label for="standing-min" class="setting-block-label">
            <svg class="icon-setting icon-apple" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M12 8.5v7"/><path d="M12 15.5l-3.5 5.5"/><path d="M12 15.5l3.5 5.5"/><path d="M8.5 11h7"/></svg>
            <span>De pie</span>
          </label>
          <div class="setting-block-input">
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
        </div>

        <div class="schedule-section">
          <h3 class="schedule-section-title">Jornada laboral</h3>
          <p class="schedule-section-desc">Horario por defecto (24 h)</p>
          <div class="schedule-grid">
            <div class="setting-block schedule-block">
              <label for="morning-start-h" class="setting-block-label">Inicio mañana</label>
              <div class="time-input-24h">
                <input
                  id="morning-start-h"
                  type="number"
                  min="0"
                  max="23"
                  :value="parseTime24(workSchedule.default.morningStart).h"
                  @input="setDefaultTime('morningStart', +(($event.target as HTMLInputElement).value) || 0, parseTime24(workSchedule.default.morningStart).m)"
                />
                <span class="time-sep">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  :value="parseTime24(workSchedule.default.morningStart).m"
                  @input="setDefaultTime('morningStart', parseTime24(workSchedule.default.morningStart).h, +(($event.target as HTMLInputElement).value) || 0)"
                />
              </div>
            </div>
            <div class="setting-block schedule-block">
              <label for="morning-end-h" class="setting-block-label">Fin mañana</label>
              <div class="time-input-24h">
                <input
                  id="morning-end-h"
                  type="number"
                  min="0"
                  max="23"
                  :value="parseTime24(workSchedule.default.morningEnd).h"
                  @input="setDefaultTime('morningEnd', +(($event.target as HTMLInputElement).value) || 0, parseTime24(workSchedule.default.morningEnd).m)"
                />
                <span class="time-sep">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  :value="parseTime24(workSchedule.default.morningEnd).m"
                  @input="setDefaultTime('morningEnd', parseTime24(workSchedule.default.morningEnd).h, +(($event.target as HTMLInputElement).value) || 0)"
                />
              </div>
            </div>
            <div class="setting-block schedule-block">
              <label for="afternoon-start-h" class="setting-block-label">Inicio tarde</label>
              <div class="time-input-24h">
                <input
                  id="afternoon-start-h"
                  type="number"
                  min="0"
                  max="23"
                  :value="parseTime24(workSchedule.default.afternoonStart).h"
                  @input="setDefaultTime('afternoonStart', +(($event.target as HTMLInputElement).value) || 0, parseTime24(workSchedule.default.afternoonStart).m)"
                />
                <span class="time-sep">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  :value="parseTime24(workSchedule.default.afternoonStart).m"
                  @input="setDefaultTime('afternoonStart', parseTime24(workSchedule.default.afternoonStart).h, +(($event.target as HTMLInputElement).value) || 0)"
                />
              </div>
            </div>
            <div class="setting-block schedule-block">
              <label for="afternoon-end-h" class="setting-block-label">Fin tarde</label>
              <div class="time-input-24h">
                <input
                  id="afternoon-end-h"
                  type="number"
                  min="0"
                  max="23"
                  :value="parseTime24(workSchedule.default.afternoonEnd).h"
                  @input="setDefaultTime('afternoonEnd', +(($event.target as HTMLInputElement).value) || 0, parseTime24(workSchedule.default.afternoonEnd).m)"
                />
                <span class="time-sep">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  :value="parseTime24(workSchedule.default.afternoonEnd).m"
                  @input="setDefaultTime('afternoonEnd', parseTime24(workSchedule.default.afternoonEnd).h, +(($event.target as HTMLInputElement).value) || 0)"
                />
              </div>
            </div>
          </div>

          <div class="schedule-overrides">
            <p class="schedule-section-desc">Días con horario distinto</p>
            <div class="schedule-day-list">
              <div
                v-for="day in 7"
                :key="day - 1"
                class="schedule-day-item"
                :class="{ 'schedule-day-item--open': expandedScheduleDay === day - 1 }"
              >
                <button
                  type="button"
                  class="schedule-day-head"
                  :aria-expanded="expandedScheduleDay === day - 1"
                  @click="expandedScheduleDay = expandedScheduleDay === day - 1 ? null : day - 1"
                >
                  <span>{{ DAY_NAMES[day - 1] }}</span>
                  <span v-if="workSchedule.overrides[day - 1]?.enabled === false" class="schedule-day-badge schedule-day-badge--off">Desactivado</span>
                  <span v-else-if="(workSchedule.overrides[day - 1]?.morningStart !== undefined) || (workSchedule.overrides[day - 1]?.afternoonEnd !== undefined)" class="schedule-day-badge">Personalizado</span>
                  <svg class="schedule-day-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div v-show="expandedScheduleDay === day - 1" class="schedule-day-body">
                  <div class="schedule-day-toggle">
                    <span class="setting-block-label">Día laborable</span>
                    <button
                      type="button"
                      class="toggle-switch"
                      :class="{ 'toggle-switch--on': isDayEnabled(day - 1) }"
                      :aria-pressed="isDayEnabled(day - 1)"
                      :aria-label="isDayEnabled(day - 1) ? 'Desactivar día' : 'Activar día'"
                      @click="setDayEnabled(day - 1, !isDayEnabled(day - 1))"
                    >
                      <span class="toggle-switch-knob" />
                    </button>
                  </div>
                  <template v-if="isDayEnabled(day - 1)">
                    <div class="schedule-grid schedule-grid--small">
                      <div class="setting-block schedule-block">
                        <label :for="'override-morning-start-h-' + (day - 1)" class="setting-block-label">Inicio mañana</label>
                        <div class="time-input-24h">
                          <input
                            :id="'override-morning-start-h-' + (day - 1)"
                            type="number"
                            min="0"
                            max="23"
                            :value="parseTime24(getScheduleForDay(day - 1).morningStart).h"
                            @input="setDayOverrideTime(day - 1, 'morningStart', +(($event.target as HTMLInputElement).value) || 0, parseTime24(getScheduleForDay(day - 1).morningStart).m)"
                          />
                          <span class="time-sep">:</span>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            :value="parseTime24(getScheduleForDay(day - 1).morningStart).m"
                            @input="setDayOverrideTime(day - 1, 'morningStart', parseTime24(getScheduleForDay(day - 1).morningStart).h, +(($event.target as HTMLInputElement).value) || 0)"
                          />
                        </div>
                      </div>
                      <div class="setting-block schedule-block">
                        <label :for="'override-morning-end-h-' + (day - 1)" class="setting-block-label">Fin mañana</label>
                        <div class="time-input-24h">
                          <input
                            :id="'override-morning-end-h-' + (day - 1)"
                            type="number"
                            min="0"
                            max="23"
                            :value="parseTime24(getScheduleForDay(day - 1).morningEnd).h"
                            @input="setDayOverrideTime(day - 1, 'morningEnd', +(($event.target as HTMLInputElement).value) || 0, parseTime24(getScheduleForDay(day - 1).morningEnd).m)"
                          />
                          <span class="time-sep">:</span>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            :value="parseTime24(getScheduleForDay(day - 1).morningEnd).m"
                            @input="setDayOverrideTime(day - 1, 'morningEnd', parseTime24(getScheduleForDay(day - 1).morningEnd).h, +(($event.target as HTMLInputElement).value) || 0)"
                          />
                        </div>
                      </div>
                      <div class="setting-block schedule-block">
                        <label :for="'override-afternoon-start-h-' + (day - 1)" class="setting-block-label">Inicio tarde</label>
                        <div class="time-input-24h">
                          <input
                            :id="'override-afternoon-start-h-' + (day - 1)"
                            type="number"
                            min="0"
                            max="23"
                            :value="parseTime24(getScheduleForDay(day - 1).afternoonStart).h"
                            @input="setDayOverrideTime(day - 1, 'afternoonStart', +(($event.target as HTMLInputElement).value) || 0, parseTime24(getScheduleForDay(day - 1).afternoonStart).m)"
                          />
                          <span class="time-sep">:</span>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            :value="parseTime24(getScheduleForDay(day - 1).afternoonStart).m"
                            @input="setDayOverrideTime(day - 1, 'afternoonStart', parseTime24(getScheduleForDay(day - 1).afternoonStart).h, +(($event.target as HTMLInputElement).value) || 0)"
                          />
                        </div>
                      </div>
                      <div class="setting-block schedule-block">
                        <label :for="'override-afternoon-end-h-' + (day - 1)" class="setting-block-label">Fin tarde</label>
                        <div class="time-input-24h">
                          <input
                            :id="'override-afternoon-end-h-' + (day - 1)"
                            type="number"
                            min="0"
                            max="23"
                            :value="parseTime24(getScheduleForDay(day - 1).afternoonEnd).h"
                            @input="setDayOverrideTime(day - 1, 'afternoonEnd', +(($event.target as HTMLInputElement).value) || 0, parseTime24(getScheduleForDay(day - 1).afternoonEnd).m)"
                          />
                          <span class="time-sep">:</span>
                          <input
                            type="number"
                            min="0"
                            max="59"
                            :value="parseTime24(getScheduleForDay(day - 1).afternoonEnd).m"
                            @input="setDayOverrideTime(day - 1, 'afternoonEnd', parseTime24(getScheduleForDay(day - 1).afternoonEnd).h, +(($event.target as HTMLInputElement).value) || 0)"
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      v-if="(workSchedule.overrides[day - 1]?.morningStart !== undefined) || (workSchedule.overrides[day - 1]?.afternoonEnd !== undefined) || (workSchedule.overrides[day - 1]?.morningEnd !== undefined) || (workSchedule.overrides[day - 1]?.afternoonStart !== undefined)"
                      type="button"
                      class="btn-secondary btn-sm"
                      @click="clearDayOverride(day - 1)"
                    >
                      Usar horario por defecto
                    </button>
                  </template>
                  <p v-else class="schedule-day-off-desc">Día no laborable</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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
        <button type="button" class="btn-secondary btn-icon-reset" aria-label="Restablecer valores" @click="resetSettings">
          <svg class="icon-btn" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          <span>Restablecer</span>
        </button>
      </div>
    </div>
  </div>
</template>
