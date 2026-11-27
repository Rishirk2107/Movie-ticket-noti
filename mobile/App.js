import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StatusBar as RNStatusBar, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import ActiveAlarmOverlay from './src/components/ActiveAlarmOverlay';
import FloatingDock from './src/components/FloatingDock';
import { COLORS } from './src/constants/theme';
import ActivityScreen from './src/screens/ActivityScreen';
import MoviesScreen from './src/screens/MoviesScreen';
import WatchesScreen from './src/screens/WatchesScreen';
import { DEFAULT_BACKEND_URL, getHealth, getWatches } from './src/services/api';
import {
  extractAlarmPayload,
  markNotificationHandled,
  registerBackgroundNotificationTask,
  registerForPushNotificationsAsync,
  shouldIgnoreNotificationResponse,
  trackAlarmNotification,
} from './src/services/notifications';
import {
  consumePendingAlarm,
  loadCachedWatches,
  loadSettings,
} from './src/services/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('movies');
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [watchId, setWatchId] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [activeAlarm, setActiveAlarm] = useState(null);
  const [watchCount, setWatchCount] = useState(0);
  const [watchesRefreshKey, setWatchesRefreshKey] = useState(0);
  const [isBackendHealthy, setIsBackendHealthy] = useState(true);

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
      const resolvedUrl = saved.backendUrl || DEFAULT_BACKEND_URL;
      setBackendUrl(resolvedUrl);
      setWatchId(saved.watchId);

      const cached = await loadCachedWatches();
      if (mounted && cached.length > 0) {
        setWatchCount(cached.length);
      }

      // Sync initial watch count & health in background for FloatingDock badges
      getWatches(resolvedUrl)
        .then((list) => {
          if (mounted && Array.isArray(list)) {
            setWatchCount(list.length);
          }
        })
        .catch(() => {});

      getHealth(resolvedUrl)
        .then(() => mounted && setIsBackendHealthy(true))
        .catch(() => mounted && setIsBackendHealthy(false));

      await registerBackgroundNotificationTask();
      await initPushToken();

      const pendingFromBg = await consumePendingAlarm();
      if (mounted && pendingFromBg) {
        setActiveAlarm(pendingFromBg);
        return;
      }

      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse && !shouldIgnoreNotificationResponse(lastResponse)) {
        const coldPayload = extractAlarmPayload(lastResponse);
        if (mounted && coldPayload) {
          trackAlarmNotification(lastResponse);
          markNotificationHandled(lastResponse);
          setActiveAlarm(coldPayload);
        }
      }
    }

    bootstrap();

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const payload = extractAlarmPayload(notification);
      if (payload) {
        trackAlarmNotification(notification);
        setActiveAlarm(payload);
      }
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (shouldIgnoreNotificationResponse(response)) return;
      const payload = extractAlarmPayload(response);
      if (payload) {
        trackAlarmNotification(response);
        markNotificationHandled(response);
        setActiveAlarm(payload);
      }
    });

    return () => {
      mounted = false;
      receivedSub.remove();
      responseSub.remove();
    };
  }, [initPushToken]);

  const handleWatchCreated = () => {
    setWatchesRefreshKey((k) => k + 1);
    setActiveTab('watches');
  };

  const handleOpenPreview = () => {
    setActiveAlarm({
      watch_id: watchId || 'preview',
      label: 'Preview Alarm - Test Watch',
      date_code: '20261218',
      venues: [{ code: 'TEST', name: 'Test Cinema IMAX' }],
      showtimes_url: 'https://in.bookmyshow.com/explore/movies-chennai',
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor={COLORS.bgBase} />

      <View style={styles.content}>
        {activeTab === 'movies' && (
          <MoviesScreen
            backendUrl={backendUrl}
            pushToken={pushToken}
            onWatchCreated={handleWatchCreated}
            onOpenActivity={() => setActiveTab('activity')}
          />
        )}

        {activeTab === 'watches' && (
          <WatchesScreen
            backendUrl={backendUrl}
            pushToken={pushToken}
            tokenError={tokenError}
            refreshTrigger={watchesRefreshKey}
            onWatchesSynced={setWatchCount}
            onOpenMovies={() => setActiveTab('movies')}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityScreen
            backendUrl={backendUrl}
            onChangeBackendUrl={setBackendUrl}
            watchId={watchId}
            onChangeWatchId={setWatchId}
            pushToken={pushToken}
            tokenError={tokenError}
            onRetryToken={initPushToken}
            onHealthUpdate={setIsBackendHealthy}
            onWatchesChanged={() => setWatchesRefreshKey((k) => k + 1)}
            onOpenAlarmPreview={handleOpenPreview}
            isActive={activeTab === 'activity'}
          />
        )}
      </View>

      <FloatingDock
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        watchCount={watchCount}
        isBackendHealthy={isBackendHealthy}
      />

      <ActiveAlarmOverlay
        alarmData={activeAlarm}
        onDismiss={() => setActiveAlarm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    paddingTop: RNStatusBar.currentHeight || 0,
  },
  content: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
});
