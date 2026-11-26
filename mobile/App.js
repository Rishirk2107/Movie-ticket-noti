import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StatusBar as RNStatusBar, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import AlarmScreen from './src/screens/AlarmScreen';
import WatchLinkerScreen from './src/screens/WatchLinkerScreen';
import {
  extractAlarmPayload,
  registerBackgroundNotificationTask,
  registerForPushNotificationsAsync,
} from './src/services/notifications';
import { consumePendingAlarm, loadSettings } from './src/services/storage';

export default function App() {
  const [backendUrl, setBackendUrl] = useState('');
  const [watchId, setWatchId] = useState('');
  const [isLinked, setIsLinked] = useState(false);

  const [pushToken, setPushToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [activeAlarm, setActiveAlarm] = useState(null);

  const initPushToken = useCallback(async () => {
    setTokenError('');
    try {
      const token = await registerForPushNotificationsAsync();
      setPushToken(token);
    } catch (err) {
      setTokenError(err.message || 'Unable to register for push notifications.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const saved = await loadSettings();
      if (!mounted) return;
      setBackendUrl(saved.backendUrl);
      setWatchId(saved.watchId);
      setIsLinked(saved.isLinked);

      await registerBackgroundNotificationTask();
      await initPushToken();

      // Check if app launched from a notification tap or background task payload
      const pendingFromBg = await consumePendingAlarm();
      if (mounted && pendingFromBg) {
        setActiveAlarm(pendingFromBg);
        return;
      }

      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      const coldPayload = extractAlarmPayload(lastResponse);
      if (mounted && coldPayload) {
        setActiveAlarm(coldPayload);
      }
    }

    bootstrap();

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const payload = extractAlarmPayload(notification);
      if (payload) {
        setActiveAlarm(payload);
      }
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = extractAlarmPayload(response);
      if (payload) {
        setActiveAlarm(payload);
      }
    });

    return () => {
      mounted = false;
      receivedSub.remove();
      responseSub.remove();
    };
  }, [initPushToken]);

  const handleOpenPreview = () => {
    setActiveAlarm({
      watch_id: watchId || 'preview',
      label: 'Preview Alarm - Test Watch',
      date_code: '20261218',
      venues: [
        { code: 'TEST', name: 'Test Cinema IMAX' },
      ],
      showtimes_url: 'https://in.bookmyshow.com/explore/movies-chennai',
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor="#0b0f19" />
      <View style={styles.root}>
        {activeAlarm ? (
          <AlarmScreen
            alarmData={activeAlarm}
            onDismiss={() => setActiveAlarm(null)}
          />
        ) : (
          <WatchLinkerScreen
            backendUrl={backendUrl}
            setBackendUrl={setBackendUrl}
            watchId={watchId}
            setWatchId={setWatchId}
            isLinked={isLinked}
            setIsLinked={setIsLinked}
            pushToken={pushToken}
            tokenError={tokenError}
            onRetryToken={initPushToken}
            onOpenTestPreview={handleOpenPreview}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b0f19',
    paddingTop: RNStatusBar.currentHeight || 0,
  },
  root: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
});
