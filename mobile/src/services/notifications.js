import { Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { savePendingAlarm } from './storage';

export const ALARM_CHANNEL_ID = 'ticket-alarm';
export const BACKGROUND_NOTIFICATION_TASK = 'BMS_TICKET_ALARM_BACKGROUND_TASK';
export const ALARM_SOUND_ASSET = require('../../assets/alarm.wav');

let activeAlarmPlayer = null;
let isAlarmPlaying = false;
let alarmGeneration = 0;
let lastStoppedAt = 0;

const trackedNotificationIds = new Set();
const handledNotificationIds = new Set();

export function getIsAlarmPlaying() {
  return isAlarmPlaying;
}

function getNotificationId(source) {
  return (
    source?.notification?.request?.identifier ||
    source?.request?.identifier ||
    null
  );
}

function getNotificationTimestampMs(source) {
  const rawDate = source?.notification?.date ?? source?.date;
  if (typeof rawDate !== 'number' || Number.isNaN(rawDate)) return 0;
  // Android/iOS may report seconds (< 1e12) or milliseconds
  return rawDate < 1e12 ? rawDate * 1000 : rawDate;
}

export function trackAlarmNotification(source) {
  const id = getNotificationId(source);
  if (id) {
    trackedNotificationIds.add(id);
  }
}

export function markNotificationHandled(source) {
  const id = getNotificationId(source);
  if (id) {
    handledNotificationIds.add(id);
  }
}

export function shouldIgnoreNotificationResponse(response) {
  if (!response) return true;
  const id = getNotificationId(response);
  if (id && handledNotificationIds.has(id)) {
    return true;
  }
  const notifMs = getNotificationTimestampMs(response);
  if (notifMs > 0 && lastStoppedAt > 0 && notifMs <= lastStoppedAt) {
    return true;
  }
  return false;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function extractAlarmPayload(source) {
  if (!source || typeof source !== 'object') return null;

  const directContentData =
    source.notification?.request?.content?.data ??
    source.request?.content?.data;

  const taskBody = source.data?.dataString
    ? parseMaybeJson(source.data.dataString)
    : source.data;

  const candidate =
    parseMaybeJson(directContentData) ||
    parseMaybeJson(taskBody?.body) ||
    parseMaybeJson(taskBody) ||
    parseMaybeJson(source);

  if (!candidate || typeof candidate !== 'object') return null;

  const hasAlarmFields =
    Boolean(candidate.watch_id) ||
    Boolean(candidate.label) ||
    Boolean(candidate.showtimes_url) ||
    Array.isArray(candidate.venues);

  if (!hasAlarmFields) return null;

  return {
    watch_id: candidate.watch_id || '',
    label: candidate.label || 'BookMyShow Ticket Alert',
    date_code: candidate.date_code || '',
    venues: Array.isArray(candidate.venues) ? candidate.venues : [],
    showtimes_url: candidate.showtimes_url || '',
  };
}

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) {
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
    const alarmPayload = extractAlarmPayload(data);
    if (alarmPayload) {
      trackAlarmNotification(data);
      await savePendingAlarm(alarmPayload);
      await startAlarmLoop();
      return Notifications.BackgroundNotificationTaskResult.NewData;
    }
    return Notifications.BackgroundNotificationTaskResult.NoData;
  });
}

export async function registerBackgroundNotificationTask() {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  } catch {
    // Task registration is supported in EAS/development builds
  }
}

export async function setupAndroidAlarmChannel() {
  if (Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
      name: 'Ticket Alarms',
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
      sound: 'alarm.wav',
      enableVibrate: true,
      vibrationPattern: [0, 500, 250, 500],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
  } catch {
    // Fallback for Expo Go where custom native raw sound 'alarm.wav' is not in res/raw
    try {
      await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
        name: 'Ticket Alarms',
        importance: Notifications.AndroidImportance.MAX,
        bypassDnd: true,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 500, 250, 500],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch {
      // Ignore if channel creation is unavailable
    }
  }
}

export async function registerForPushNotificationsAsync() {
  await setupAndroidAlarmChannel();

  if (Platform.OS === 'web') {
    throw new Error('Push notifications require an Android or iOS device.');
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  if (!Device.isDevice) {
    throw new Error('Must use a physical device to receive push notifications.');
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenResult.data;
}

export async function configureAlarmAudioMode() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  } catch {
    // Proceed even if audio mode configuration is restricted
  }
}

export async function startAlarmLoop() {
  if (isAlarmPlaying && activeAlarmPlayer) {
    try {
      activeAlarmPlayer.loop = true;
      activeAlarmPlayer.volume = 1.0;
      activeAlarmPlayer.play();
    } catch {
      // Fall through to recreate if existing handle became invalid
    }
    return;
  }

  // Tear down any stale player before starting a new generation
  if (activeAlarmPlayer) {
    const stale = activeAlarmPlayer;
    activeAlarmPlayer = null;
    try {
      stale.pause();
    } catch {}
    try {
      stale.remove?.();
    } catch {}
  }

  const myGeneration = ++alarmGeneration;
  isAlarmPlaying = true;
  await configureAlarmAudioMode();

  // Abort if stopAlarmLoop() ran while awaiting audio mode configuration
  if (!isAlarmPlaying || myGeneration !== alarmGeneration) {
    return;
  }

  try {
    const player = createAudioPlayer(ALARM_SOUND_ASSET);
    if (!isAlarmPlaying || myGeneration !== alarmGeneration) {
      try {
        player.pause();
      } catch {}
      try {
        player.remove?.();
      } catch {}
      return;
    }
    player.loop = true;
    player.volume = 1.0;
    player.play();
    activeAlarmPlayer = player;
  } catch {
    activeAlarmPlayer = null;
    isAlarmPlaying = false;
  }

  if (isAlarmPlaying && myGeneration === alarmGeneration) {
    try {
      Vibration.vibrate([0, 600, 300], true);
    } catch {
      // Ignore vibration errors on unsupported devices
    }
  }
}

export async function stopAlarmLoop() {
  isAlarmPlaying = false;
  alarmGeneration += 1;
  lastStoppedAt = Date.now();

  const idsToDismiss = Array.from(trackedNotificationIds);
  for (const id of idsToDismiss) {
    handledNotificationIds.add(id);
  }
  trackedNotificationIds.clear();

  const player = activeAlarmPlayer;
  activeAlarmPlayer = null;

  try {
    Vibration.cancel();
  } catch {
    // Ignore vibration cancel errors
  }

  if (player) {
    try {
      player.pause();
    } catch {
      // Continue cleanup
    }

    try {
      if (typeof player.stop === 'function') {
        player.stop();
      }
    } catch {
      // Continue cleanup
    }

    try {
      await player.seekTo(0);
    } catch {
      // Continue cleanup
    }

    try {
      if (typeof player.remove === 'function') {
        player.remove();
      }
    } catch {
      // Continue cleanup
    }

    try {
      if (typeof player.unloadAsync === 'function') {
        await player.unloadAsync();
      }
    } catch {
      // Continue cleanup
    }
  }

  for (const id of idsToDismiss) {
    try {
      await Notifications.dismissNotificationAsync(id);
    } catch {
      // Ignore per-notification dismiss errors
    }
  }

  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // Ignore tray dismissal errors
  }

  try {
    if (typeof Notifications.clearLastNotificationResponseAsync === 'function') {
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch {
    // Ignore clear response errors
  }
}
