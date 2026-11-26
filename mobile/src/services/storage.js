import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  BACKEND_URL: '@bms_alarm/backend_url',
  WATCH_ID: '@bms_alarm/watch_id',
  LINKED_STATE: '@bms_alarm/linked_state',
  PENDING_ALARM: '@bms_alarm/pending_alarm',
};

export async function loadSettings() {
  try {
    const entries = await AsyncStorage.multiGet([
      KEYS.BACKEND_URL,
      KEYS.WATCH_ID,
      KEYS.LINKED_STATE,
    ]);
    const map = Object.fromEntries(entries);
    let linked = false;
    try {
      linked = map[KEYS.LINKED_STATE] ? JSON.parse(map[KEYS.LINKED_STATE]) : false;
    } catch {
      linked = false;
    }
    return {
      backendUrl: map[KEYS.BACKEND_URL] || '',
      watchId: map[KEYS.WATCH_ID] || '',
      isLinked: Boolean(linked),
    };
  } catch {
    return { backendUrl: '', watchId: '', isLinked: false };
  }
}

export async function saveSettings({ backendUrl, watchId, isLinked }) {
  const ops = [];
  if (typeof backendUrl === 'string') {
    ops.push([KEYS.BACKEND_URL, backendUrl.trim()]);
  }
  if (typeof watchId === 'string') {
    ops.push([KEYS.WATCH_ID, watchId.trim()]);
  }
  if (typeof isLinked === 'boolean') {
    ops.push([KEYS.LINKED_STATE, JSON.stringify(isLinked)]);
  }
  if (ops.length > 0) {
    await AsyncStorage.multiSet(ops);
  }
}

export async function savePendingAlarm(alarmPayload) {
  if (!alarmPayload) return;
  try {
    await AsyncStorage.setItem(KEYS.PENDING_ALARM, JSON.stringify(alarmPayload));
  } catch {
    // Ignore storage errors in background context
  }
}

export async function consumePendingAlarm() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PENDING_ALARM);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEYS.PENDING_ALARM);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
