import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { savePendingAlarm } from './storage';

export const ALARM_CHANNEL_ID = 'ticket-alarm';
export const BACKGROUND_NOTIFICATION_TASK = 'BMS_TICKET_ALARM_BACKGROUND_TASK';

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

  // 1. Direct Notification or NotificationResponse object
  const directContentData =
    source.notification?.request?.content?.data ??
    source.request?.content?.data;

  // 2. Background TaskManager data payloads (FCM dataString / nested body)
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
      await savePendingAlarm(alarmPayload);
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
    // Task registration may not be supported in Expo Go; succeeds in dev/EAS builds
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
    // Fallback for Expo Go where custom native raw sound 'alarm.wav' is not bundled in res/raw
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
      // Ignore if channel creation is unavailable in current runtime
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
