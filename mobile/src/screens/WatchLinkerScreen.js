import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  fetchWatches,
  linkDevice,
  triggerTestAlarm,
  unlinkDevice,
} from '../services/api';
import {
  loadCachedWatches,
  saveCachedWatches,
  saveSettings,
} from '../services/storage';

function isValidHttpUrl(raw) {
  const trimmed = (raw || '').trim();
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed);
}

function formatDateWindow(start, end) {
  if (!start && !end) return 'Auto-discovered dates';
  if (start && end && start !== end) return `${start} to ${end}`;
  return start || end;
}

function formatLanguageAndFormat(language, etCodes) {
  const langLabel = language
    ? language.charAt(0).toUpperCase() + language.slice(1)
    : 'All Languages';
  const fmtLabel = !etCodes || etCodes === '*' ? 'All Formats (*)' : etCodes;
  return `${langLabel} / ${fmtLabel}`;
}

export default function WatchLinkerScreen({
  backendUrl,
  setBackendUrl,
  watchId,
  setWatchId,
  isLinked,
  setIsLinked,
  pushToken,
  tokenError,
  onRetryToken,
  onOpenTestPreview,
}) {
  const [watches, setWatches] = useState([]);
  const [activeWatchIds, setActiveWatchIds] = useState(() => new Set());
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [watchesError, setWatchesError] = useState(null);
  const [showingCached, setShowingCached] = useState(false);

  // Per-watch loading & feedback states so toggling one watch doesn't lock others
  const [togglingIds, setTogglingIds] = useState({});
  const [testingIds, setTestingIds] = useState({});
  const [cardFeedback, setCardFeedback] = useState({});

  // Manual fallback state (collapsible)
  const [manualExpanded, setManualExpanded] = useState(false);
  const [manualBusy, setManualBusy] = useState(null);
  const [manualFeedback, setManualFeedback] = useState(null);

  const lastSyncedUrlRef = useRef('');

  const recomputeActiveWatchIds = useCallback(
    (watchList, token) => {
      const next = new Set();
      if (token && Array.isArray(watchList)) {
        for (const w of watchList) {
          if (Array.isArray(w?.device_tokens) && w.device_tokens.includes(token)) {
            next.add(w._id);
          }
        }
      }
      setActiveWatchIds(next);
      return next;
    },
    []
  );

  // Load cached watches immediately on mount for offline resilience
  useEffect(() => {
    let mounted = true;
    loadCachedWatches().then((cached) => {
      if (!mounted || cached.length === 0) return;
      setWatches(cached);
      setShowingCached(true);
      recomputeActiveWatchIds(cached, pushToken);
    });
    return () => {
      mounted = false;
    };
  }, [pushToken, recomputeActiveWatchIds]);

  // Recompute linked watch IDs whenever pushToken arrives or updates
  useEffect(() => {
    recomputeActiveWatchIds(watches, pushToken);
  }, [pushToken, watches, recomputeActiveWatchIds]);

  const syncWatches = useCallback(
    async (urlOverride, { isPullRefresh = false } = {}) => {
      const targetUrl = (urlOverride !== undefined ? urlOverride : backendUrl).trim();
      if (!isValidHttpUrl(targetUrl)) {
        return;
      }

      if (isPullRefresh) {
        setRefreshing(true);
      } else {
        setLoadingWatches(true);
      }
      setWatchesError(null);

      try {
        const list = await fetchWatches(targetUrl);
        const normalized = Array.isArray(list) ? list : [];
        setWatches(normalized);
        setShowingCached(false);
        recomputeActiveWatchIds(normalized, pushToken);
        await saveCachedWatches(normalized);
        lastSyncedUrlRef.current = targetUrl;
      } catch (err) {
        setWatchesError(err.message || 'Unable to reach backend.');
      } finally {
        setLoadingWatches(false);
        setRefreshing(false);
      }
    },
    [backendUrl, pushToken, recomputeActiveWatchIds]
  );

  // Auto-sync when a valid Backend URL is loaded or saved (debounced when typing)
  useEffect(() => {
    const trimmed = backendUrl.trim();
    if (!isValidHttpUrl(trimmed)) return;
    if (lastSyncedUrlRef.current === trimmed) return;

    const timer = setTimeout(() => {
      syncWatches(trimmed);
    }, 450);

    return () => clearTimeout(timer);
  }, [backendUrl, syncWatches]);

  const handleToggleWatchAlarm = async (watch) => {
    const id = watch._id;
    if (!isValidHttpUrl(backendUrl)) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: { type: 'error', message: 'Enter a valid Backend URL first.' },
      }));
      return;
    }
    if (!pushToken) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: {
          type: 'error',
          message: tokenError || 'Device push token is not ready yet.',
        },
      }));
      return;
    }

    const currentlyLinked = activeWatchIds.has(id);
    setTogglingIds((prev) => ({ ...prev, [id]: true }));
    setCardFeedback((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      if (currentlyLinked) {
        await unlinkDevice(backendUrl, id, pushToken);
        setCardFeedback((prev) => ({
          ...prev,
          [id]: { type: 'success', message: 'Alarm disabled for this device.' },
        }));
      } else {
        await linkDevice(backendUrl, id, pushToken);
        setCardFeedback((prev) => ({
          ...prev,
          [id]: { type: 'success', message: 'Alarm enabled for this device.' },
        }));
      }
      await syncWatches(backendUrl);
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: {
          type: 'error',
          message: err.message || 'Failed to update watch alarm.',
        },
      }));
    } finally {
      setTogglingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleTestWatchAlarm = async (watch) => {
    const id = watch._id;
    if (!isValidHttpUrl(backendUrl)) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: { type: 'error', message: 'Enter a valid Backend URL first.' },
      }));
      return;
    }

    setTestingIds((prev) => ({ ...prev, [id]: true }));
    setCardFeedback((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const res = await triggerTestAlarm(backendUrl, id);
      const tickets = Array.isArray(res?.data)
        ? res.data
        : res?.data
          ? [res.data]
          : [];
      const failed = tickets.find((t) => t?.status === 'error');
      if (failed) {
        setCardFeedback((prev) => ({
          ...prev,
          [id]: {
            type: 'error',
            message: failed.message || 'Push service reported a delivery error.',
          },
        }));
      } else {
        setCardFeedback((prev) => ({
          ...prev,
          [id]: {
            type: 'success',
            message: 'Test alarm sent.',
          },
        }));
      }
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: {
          type: 'error',
          message: err.message || 'Failed to trigger test alarm.',
        },
      }));
    } finally {
      setTestingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Manual fallback handlers
  const validateManualInputs = (requireToken = false) => {
    if (!backendUrl.trim()) {
      setManualFeedback({ type: 'error', message: 'Enter your backend URL first.' });
      return false;
    }
    if (!watchId.trim()) {
      setManualFeedback({ type: 'error', message: 'Enter a Watch ID first.' });
      return false;
    }
    if (requireToken && !pushToken) {
      setManualFeedback({
        type: 'error',
        message: tokenError || 'Push token is not ready yet.',
      });
      return false;
    }
    return true;
  };

  const handleManualLink = async () => {
    if (!validateManualInputs(true)) return;
    setManualBusy('link');
    setManualFeedback(null);
    try {
      const devices = await linkDevice(backendUrl, watchId, pushToken);
      setIsLinked(true);
      await saveSettings({ backendUrl, watchId, isLinked: true });
      const count = Array.isArray(devices) ? devices.length : 1;
      setManualFeedback({
        type: 'success',
        message: `Linked to ${watchId.trim()} (${count} linked ${count === 1 ? 'device' : 'devices'}).`,
      });
      await syncWatches(backendUrl);
    } catch (err) {
      setManualFeedback({
        type: 'error',
        message: err.message || 'Failed to link device.',
      });
    } finally {
      setManualBusy(null);
    }
  };

  const handleManualUnlink = async () => {
    if (!validateManualInputs(true)) return;
    setManualBusy('unlink');
    setManualFeedback(null);
    try {
      await unlinkDevice(backendUrl, watchId, pushToken);
      setIsLinked(false);
      await saveSettings({ backendUrl, watchId, isLinked: false });
      setManualFeedback({
        type: 'success',
        message: `Unlinked from ${watchId.trim()}.`,
      });
      await syncWatches(backendUrl);
    } catch (err) {
      setManualFeedback({
        type: 'error',
        message: err.message || 'Failed to unlink device.',
      });
    } finally {
      setManualBusy(null);
    }
  };

  const handleManualTestAlarm = async () => {
    if (!validateManualInputs(false)) return;
    setManualBusy('test');
    setManualFeedback(null);
    try {
      await saveSettings({ backendUrl, watchId, isLinked });
      const res = await triggerTestAlarm(backendUrl, watchId);
      const tickets = Array.isArray(res?.data)
        ? res.data
        : res?.data
          ? [res.data]
          : [];
      const failed = tickets.find((t) => t?.status === 'error');
      if (failed) {
        setManualFeedback({
          type: 'error',
          message: failed.message || 'Push service reported a delivery error.',
        });
      } else {
        setManualFeedback({
          type: 'success',
          message: 'Test alarm dispatched.',
        });
      }
    } catch (err) {
      setManualFeedback({
        type: 'error',
        message: err.message || 'Failed to trigger test alarm.',
      });
    } finally {
      setManualBusy(null);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => syncWatches(backendUrl, { isPullRefresh: true })}
          tintColor="#ef4444"
          colors={['#ef4444']}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>TICKET ALARM COMPANION</Text>
        </View>
        <Text style={styles.title}>Watch Alarms & Controls</Text>
        <Text style={styles.subtitle}>
          Sync active BookMyShow watches from your backend and enable high-priority alarms for any movie.
        </Text>
      </View>

      {/* Backend URL Card */}
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Backend Connection</Text>
          <TouchableOpacity
            style={[styles.refreshBtn, loadingWatches && styles.btnDisabled]}
            disabled={loadingWatches || !isValidHttpUrl(backendUrl)}
            onPress={() => syncWatches(backendUrl)}
          >
            <Text style={styles.refreshBtnText}>
              {loadingWatches ? 'Syncing...' : 'Refresh Watches'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>BACKEND BASE URL</Text>
        <TextInput
          style={styles.input}
          value={backendUrl}
          onChangeText={(val) => {
            setBackendUrl(val);
            saveSettings({ backendUrl: val });
          }}
          placeholder="http://192.168.1.5:8000 or https://..."
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <View style={styles.tokenSummaryRow}>
          <Text style={styles.label}>DEVICE PUSH TOKEN</Text>
          {!pushToken && (
            <TouchableOpacity onPress={onRetryToken} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
        {pushToken ? (
          <Text selectable numberOfLines={1} ellipsizeMode="middle" style={styles.tokenBox}>
            {pushToken}
          </Text>
        ) : (
          <View style={styles.tokenErrorBox}>
            <Text style={styles.tokenErrorText}>
              {tokenError || 'Waiting for notification permission and device token...'}
            </Text>
          </View>
        )}
      </View>

      {/* Active Watches List */}
      <View style={styles.watchesSection}>
        <View style={styles.watchesHeader}>
          <Text style={styles.watchesHeading}>
            Active Watches ({watches.length})
          </Text>
          <Text style={styles.linkedCountText}>
            {activeWatchIds.size} linked
          </Text>
        </View>

        {showingCached && watchesError && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>
              Showing cached watches ({watchesError})
            </Text>
          </View>
        )}

        {!showingCached && watchesError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{watchesError}</Text>
          </View>
        )}

        {loadingWatches && watches.length === 0 ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color="#ef4444" size="small" />
            <Text style={styles.emptyText}>Loading active watches...</Text>
          </View>
        ) : watches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No Watches Loaded</Text>
            <Text style={styles.emptyText}>
              {isValidHttpUrl(backendUrl)
                ? 'No active watches found on the backend. Create one on the web dashboard, then tap Refresh Watches.'
                : 'Enter a valid Backend Base URL above to load your active watches.'}
            </Text>
          </View>
        ) : (
          watches.map((watch) => {
            const id = watch._id;
            const isWatchLinked = activeWatchIds.has(id);
            const isToggling = Boolean(togglingIds[id]);
            const isTesting = Boolean(testingIds[id]);
            const feedback = cardFeedback[id];
            const showMovieName =
              Boolean(watch.movie_name) && watch.movie_name !== watch.label;

            return (
              <View
                key={id}
                style={[
                  styles.watchCard,
                  isWatchLinked && styles.watchCardLinked,
                ]}
              >
                <View style={styles.watchTopRow}>
                  <View style={styles.watchTitleBlock}>
                    <Text style={styles.watchLabel}>{watch.label || id}</Text>
                    {showMovieName && (
                      <Text style={styles.watchMovieName}>{watch.movie_name}</Text>
                    )}
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      isWatchLinked ? styles.pillActive : styles.pillIdle,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        isWatchLinked ? styles.dotActive : styles.dotIdle,
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusText,
                        isWatchLinked ? styles.textActive : styles.textIdle,
                      ]}
                    >
                      {isWatchLinked ? 'Alarm Linked' : 'Off'}
                    </Text>
                  </View>
                </View>

                <View style={styles.watchMetaBlock}>
                  <Text style={styles.watchMetaLine}>
                    Format: {formatLanguageAndFormat(watch.language, watch.et_codes)}
                  </Text>
                  <Text style={styles.watchMetaLine}>
                    Dates: {formatDateWindow(watch.start_date, watch.end_date)}
                  </Text>
                  <Text style={styles.watchMetaId}>Watch ID: {id}</Text>
                </View>

                <View style={styles.watchActionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      isWatchLinked ? styles.toggleBtnDisable : styles.toggleBtnEnable,
                      isToggling && styles.btnDisabled,
                    ]}
                    disabled={isToggling}
                    onPress={() => handleToggleWatchAlarm(watch)}
                  >
                    {isToggling ? (
                      <ActivityIndicator
                        color={isWatchLinked ? '#f87171' : '#ffffff'}
                        size="small"
                      />
                    ) : (
                      <Text
                        style={
                          isWatchLinked
                            ? styles.toggleBtnDisableText
                            : styles.toggleBtnEnableText
                        }
                      >
                        {isWatchLinked ? 'Disable Alarm' : 'Enable Alarm'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  {isWatchLinked && (
                    <TouchableOpacity
                      style={[styles.compactTestBtn, isTesting && styles.btnDisabled]}
                      disabled={isTesting}
                      onPress={() => handleTestWatchAlarm(watch)}
                    >
                      {isTesting ? (
                        <ActivityIndicator color="#f9fafb" size="small" />
                      ) : (
                        <Text style={styles.compactTestBtnText}>Test</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>

                {feedback && (
                  <View
                    style={[
                      styles.feedbackBox,
                      styles.cardFeedbackSpacing,
                      feedback.type === 'success'
                        ? styles.feedbackSuccess
                        : styles.feedbackError,
                    ]}
                  >
                    <Text
                      style={
                        feedback.type === 'success'
                          ? styles.feedbackSuccessText
                          : styles.feedbackErrorText
                      }
                    >
                      {feedback.message}
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>

      {/* Collapsible Manual Watch ID Fallback */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => setManualExpanded((prev) => !prev)}
        >
          <Text style={styles.collapsibleTitle}>Link by Watch ID (Manual)</Text>
          <Text style={styles.collapsibleToggle}>
            {manualExpanded ? 'Hide' : 'Show'}
          </Text>
        </TouchableOpacity>

        {manualExpanded && (
          <View style={styles.collapsibleBody}>
            <Text style={styles.label}>WATCH ID</Text>
            <TextInput
              style={[styles.input, styles.monoInput]}
              value={watchId}
              onChangeText={(val) => {
                setWatchId(val);
                saveSettings({ watchId: val });
              }}
              placeholder="e.g. 8d66eee0"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, manualBusy && styles.btnDisabled]}
                disabled={Boolean(manualBusy)}
                onPress={handleManualLink}
              >
                {manualBusy === 'link' ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Link Device</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnOutlineDanger, manualBusy && styles.btnDisabled]}
                disabled={Boolean(manualBusy)}
                onPress={handleManualUnlink}
              >
                {manualBusy === 'unlink' ? (
                  <ActivityIndicator color="#f87171" size="small" />
                ) : (
                  <Text style={styles.btnOutlineDangerText}>Unlink</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary, manualBusy && styles.btnDisabled]}
              disabled={Boolean(manualBusy)}
              onPress={handleManualTestAlarm}
            >
              {manualBusy === 'test' ? (
                <ActivityIndicator color="#f9fafb" size="small" />
              ) : (
                <Text style={styles.btnSecondaryText}>Test Alarm (Manual ID)</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={onOpenTestPreview}
            >
              <Text style={styles.btnGhostText}>Preview Local Alarm Screen</Text>
            </TouchableOpacity>

            {manualFeedback && (
              <View
                style={[
                  styles.feedbackBox,
                  manualFeedback.type === 'success'
                    ? styles.feedbackSuccess
                    : styles.feedbackError,
                ]}
              >
                <Text
                  style={
                    manualFeedback.type === 'success'
                      ? styles.feedbackSuccessText
                      : styles.feedbackErrorText
                  }
                >
                  {manualFeedback.message}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    marginBottom: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  badgeText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    color: '#f9fafb',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
  },
  refreshBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  refreshBtnText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '600',
  },
  label: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0b0f19',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
    fontSize: 14,
    marginBottom: 14,
  },
  monoInput: {
    fontFamily: 'monospace',
  },
  tokenSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retryBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  retryText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '600',
  },
  tokenBox: {
    backgroundColor: '#0b0f19',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: 10,
    color: '#cbd5e1',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  tokenErrorBox: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
    borderRadius: 8,
    padding: 10,
  },
  tokenErrorText: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 18,
  },
  watchesSection: {
    gap: 12,
  },
  watchesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  watchesHeading: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
  },
  linkedCountText: {
    color: '#34d399',
    fontSize: 13,
    fontWeight: '700',
  },
  offlineBanner: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    borderRadius: 8,
    padding: 10,
  },
  offlineBannerText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    borderRadius: 8,
    padding: 10,
  },
  errorBannerText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  watchCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 15,
  },
  watchCardLinked: {
    borderColor: 'rgba(52, 211, 153, 0.38)',
  },
  watchTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  watchTitleBlock: {
    flex: 1,
  },
  watchLabel: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
  },
  watchMovieName: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillActive: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  pillIdle: {
    backgroundColor: '#1e293b',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: '#34d399',
  },
  dotIdle: {
    backgroundColor: '#9ca3af',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textActive: {
    color: '#34d399',
  },
  textIdle: {
    color: '#9ca3af',
  },
  watchMetaBlock: {
    gap: 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12,
  },
  watchMetaLine: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  watchMetaId: {
    color: '#64748b',
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 2,
  },
  watchActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnEnable: {
    backgroundColor: '#ef4444',
  },
  toggleBtnEnableText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  toggleBtnDisable: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  toggleBtnDisableText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '700',
  },
  compactTestBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTestBtnText: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
  cardFeedbackSpacing: {
    marginTop: 10,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  collapsibleToggle: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  collapsibleBody: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    gap: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#ef4444',
  },
  btnPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  btnOutlineDanger: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  btnOutlineDangerText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  btnSecondaryText: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '700',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  btnGhostText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackBox: {
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  feedbackError: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  feedbackSuccessText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
  },
  feedbackErrorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
});
