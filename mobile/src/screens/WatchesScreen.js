import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import WatchDetailSheet from '../components/WatchDetailSheet';
import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import {
  deleteWatch,
  getWatches,
  linkDevice,
  triggerTestAlarm,
  unlinkDevice,
} from '../services/api';
import { loadCachedWatches, saveCachedWatches } from '../services/storage';
import { formatDateCode, isValidHttpUrl } from '../utils/dateHelpers';

function formatLanguageAndFormat(language, etCodes) {
  const lang = language
    ? language.charAt(0).toUpperCase() + language.slice(1)
    : 'All';
  const fmt = !etCodes || etCodes === '*' ? 'All Formats (*)' : etCodes;
  return `${lang} • ${fmt}`;
}

function formatDateRange(start, end) {
  if (!start && !end) return 'Auto-discovered dates';
  if (start && end && start !== end) {
    return `${formatDateCode(start)} - ${formatDateCode(end)}`;
  }
  return formatDateCode(start || end);
}

export default function WatchesScreen({
  backendUrl,
  pushToken,
  tokenError,
  refreshTrigger,
  onWatchesSynced,
  onOpenMovies,
}) {
  const [watches, setWatches] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [showingCached, setShowingCached] = useState(false);

  const [togglingIds, setTogglingIds] = useState({});
  const [testingIds, setTestingIds] = useState({});
  const [deletingIds, setDeletingIds] = useState({});
  const [cardFeedback, setCardFeedback] = useState({});
  const [detailWatch, setDetailWatch] = useState(null);

  const hasLoadedCacheRef = useRef(false);

  const activeWatchIds = useMemo(() => {
    const next = new Set();
    if (pushToken && Array.isArray(watches)) {
      for (const w of watches) {
        if (Array.isArray(w?.device_tokens) && w.device_tokens.includes(pushToken)) {
          next.add(w._id);
        }
      }
    }
    return next;
  }, [watches, pushToken]);

  useEffect(() => {
    if (hasLoadedCacheRef.current) return;
    hasLoadedCacheRef.current = true;
    loadCachedWatches().then((cached) => {
      if (cached.length > 0) {
        setWatches(cached);
        setShowingCached(true);
        onWatchesSynced?.(cached.length);
      }
    });
  }, [onWatchesSynced]);

  const syncWatches = useCallback(
    async ({ isPullRefresh = false } = {}) => {
      if (!isValidHttpUrl(backendUrl)) {
        setError('Configure a valid Backend Base URL in the Activity tab.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (isPullRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const list = await getWatches(backendUrl);
        const normalized = Array.isArray(list) ? list : [];
        setWatches(normalized);
        setShowingCached(false);
        onWatchesSynced?.(normalized.length);
        await saveCachedWatches(normalized);

        if (detailWatch) {
          const updatedDetail = normalized.find((w) => w._id === detailWatch._id);
          if (updatedDetail) setDetailWatch(updatedDetail);
        }
      } catch (err) {
        setError(err.message || 'Unable to fetch watches.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [backendUrl, detailWatch, onWatchesSynced]
  );

  useEffect(() => {
    syncWatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, refreshTrigger]);

  const handleToggleAlarm = async (watch) => {
    const id = watch._id;
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
      } else {
        await linkDevice(backendUrl, id, pushToken);
      }
      await syncWatches();
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: { type: 'error', message: err.message || 'Failed to update alarm.' },
      }));
    } finally {
      setTogglingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleTestAlarm = async (watch) => {
    const id = watch._id;
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
          [id]: { type: 'success', message: 'Test alarm sent.' },
        }));
      }
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: { type: 'error', message: err.message || 'Failed to send test alarm.' },
      }));
    } finally {
      setTestingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteWatch = async (watch) => {
    const id = watch._id;
    setDeletingIds((prev) => ({ ...prev, [id]: true }));
    try {
      await deleteWatch(backendUrl, id);
      setWatches((prev) => {
        const next = prev.filter((w) => w._id !== id);
        saveCachedWatches(next);
        onWatchesSynced?.(next.length);
        return next;
      });
      setDetailWatch(null);
    } catch (err) {
      setCardFeedback((prev) => ({
        ...prev,
        [id]: { type: 'error', message: err.message || 'Failed to delete watch.' },
      }));
    } finally {
      setDeletingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const filteredWatches = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return watches;
    return watches.filter(
      (w) =>
        (w.label && w.label.toLowerCase().includes(q)) ||
        (w.movie_name && w.movie_name.toLowerCase().includes(q)) ||
        (w.ref_event_code && w.ref_event_code.toLowerCase().includes(q)) ||
        (w._id && w._id.toLowerCase().includes(q))
    );
  }, [watches, searchQuery]);

  return (
    <View style={styles.screen}>
      {/* Pinned Header & Search */}
      <View style={styles.pinnedHeader}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>ALARM MONITOR</Text>
            <Text style={styles.pageTitle}>Watches</Text>
          </View>
          <View style={styles.counterBadge}>
            <View style={styles.counterDot} />
            <Text style={styles.counterText}>
              {activeWatchIds.size} of {watches.length} linked
            </Text>
          </View>
        </View>

        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search watches by title, code, or Watch ID..."
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
          />
          {Boolean(searchQuery) && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.listContainer}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => syncWatches({ isPullRefresh: true })}
            tintColor={COLORS.crimson}
            colors={[COLORS.crimson]}
          />
        }
      >
        {showingCached && error && (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>Showing cached watches ({error})</Text>
          </View>
        )}

        {!showingCached && error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading && watches.length === 0 ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color={COLORS.crimson} size="small" />
            <Text style={styles.mutedText}>Loading active watches...</Text>
          </View>
        ) : filteredWatches.length === 0 ? (
          <View style={styles.centerCard}>
            <Text style={styles.emptyTitle}>No Watches Found</Text>
            <Text style={styles.mutedText}>
              {searchQuery
                ? `No watches match "${searchQuery}".`
                : 'Pick a movie from the Movies tab to start tracking theatre openings.'}
            </Text>
            <TouchableOpacity style={styles.ctaBtn} onPress={onOpenMovies}>
              <Text style={styles.ctaBtnText}>Browse Movies</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredWatches.map((w) => {
            const id = w._id;
            const linked = activeWatchIds.has(id);
            const isToggling = Boolean(togglingIds[id]);
            const isTesting = Boolean(testingIds[id]);
            const feedback = cardFeedback[id];
            const showMovie = Boolean(w.movie_name) && w.movie_name !== w.label;

            return (
              <TouchableOpacity
                key={id}
                style={[styles.card, SHADOWS.card, linked && styles.cardLinked]}
                activeOpacity={0.86}
                onPress={() => setDetailWatch(w)}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardTitleWrap}>
                    <Text style={styles.cardTitle}>{w.label || id}</Text>
                    {showMovie && (
                      <Text style={styles.cardSub}>{w.movie_name}</Text>
                    )}
                  </View>

                  <View style={styles.switchControl}>
                    <Text
                      style={[
                        styles.switchStatus,
                        linked ? styles.switchStatusOn : styles.switchStatusOff,
                      ]}
                    >
                      {linked ? 'Alarm On' : 'Off'}
                    </Text>
                    {isToggling ? (
                      <ActivityIndicator color={COLORS.emerald} size="small" />
                    ) : (
                      <Switch
                        value={linked}
                        onValueChange={() => handleToggleAlarm(w)}
                        trackColor={{
                          false: COLORS.bgElevated,
                          true: COLORS.emeraldBorder,
                        }}
                        thumbColor={linked ? COLORS.emerald : COLORS.textMuted}
                      />
                    )}
                  </View>
                </View>

                <View style={styles.cardMeta}>
                  <Text style={styles.metaText}>
                    {formatLanguageAndFormat(w.language, w.et_codes)}
                  </Text>
                  <Text style={styles.metaText}>
                    {formatDateRange(w.start_date, w.end_date)}
                  </Text>
                </View>

                <View style={styles.cardBottom}>
                  <View style={styles.bottomLeft}>
                    <Text style={styles.idText}>ID: {id}</Text>
                    <Text style={styles.venuesCountText}>
                      {w.known_venue_count || 0} theatres
                    </Text>
                  </View>

                  <View style={styles.bottomActions}>
                    {linked && (
                      <TouchableOpacity
                        style={[styles.testBtn, isTesting && styles.btnDisabled]}
                        disabled={isTesting}
                        onPress={() => handleTestAlarm(w)}
                      >
                        {isTesting ? (
                          <ActivityIndicator color={COLORS.textMain} size="small" />
                        ) : (
                          <Text style={styles.testBtnText}>Test</Text>
                        )}
                      </TouchableOpacity>
                    )}
                    <Text style={styles.inspectHint}>Details</Text>
                  </View>
                </View>

                {feedback && (
                  <View
                    style={[
                      styles.feedbackBox,
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
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <WatchDetailSheet
        watch={detailWatch}
        backendUrl={backendUrl}
        isAlarmLinked={detailWatch ? activeWatchIds.has(detailWatch._id) : false}
        isTesting={detailWatch ? Boolean(testingIds[detailWatch._id]) : false}
        isDeleting={detailWatch ? Boolean(deletingIds[detailWatch._id]) : false}
        feedback={detailWatch ? cardFeedback[detailWatch._id] : null}
        onTestAlarm={handleTestAlarm}
        onDeleteWatch={handleDeleteWatch}
        onClose={() => setDetailWatch(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
  pinnedHeader: {
    backgroundColor: COLORS.bgGlass,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGlass,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  kicker: {
    color: COLORS.crimson,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  pageTitle: {
    color: COLORS.textMain,
    fontSize: 22,
    fontWeight: '800',
  },
  counterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  counterDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.emerald,
  },
  counterText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textMain,
    fontSize: 14,
    paddingVertical: 9,
  },
  clearText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingLeft: 8,
  },
  scroll: {
    flex: 1,
  },
  listContainer: {
    padding: 14,
    paddingBottom: 96,
    gap: 12,
  },
  warnBanner: {
    backgroundColor: COLORS.amberSubtle,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    borderRadius: RADII.sm,
    padding: 10,
  },
  warnText: {
    color: COLORS.amber,
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    padding: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  centerCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '700',
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  ctaBtn: {
    marginTop: 6,
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 15,
    gap: 10,
  },
  cardLinked: {
    borderColor: COLORS.emeraldBorder,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  switchControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  switchStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  switchStatusOn: {
    color: COLORS.emerald,
  },
  switchStatusOff: {
    color: COLORS.textDim,
  },
  cardMeta: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.borderGlass,
    paddingVertical: 8,
    gap: 3,
  },
  metaText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  idText: {
    color: COLORS.textDim,
    fontFamily: MONO_FONT,
    fontSize: 11,
  },
  venuesCountText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  testBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  testBtnText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  inspectHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  feedbackBox: {
    borderRadius: RADII.sm,
    padding: 8,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: COLORS.emeraldSubtle,
    borderColor: COLORS.emeraldBorder,
  },
  feedbackError: {
    backgroundColor: COLORS.dangerSubtle,
    borderColor: COLORS.dangerBorder,
  },
  feedbackSuccessText: {
    color: COLORS.emerald,
    fontSize: 12,
    fontWeight: '600',
  },
  feedbackErrorText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
});
