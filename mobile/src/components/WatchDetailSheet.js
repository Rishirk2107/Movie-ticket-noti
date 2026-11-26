import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, MONO_FONT, RADII } from '../constants/theme';
import { getWatchVenues } from '../services/api';
import { formatDateCode } from '../utils/dateHelpers';

function formatLanguageAndFormat(language, etCodes) {
  const langLabel = language
    ? language.charAt(0).toUpperCase() + language.slice(1)
    : 'All Languages';
  const fmtLabel = !etCodes || etCodes === '*' ? 'All Formats (*)' : etCodes;
  return `${langLabel} / ${fmtLabel}`;
}

function formatDateRange(start, end) {
  if (!start && !end) return 'Auto-discovered dates';
  if (start && end && start !== end) {
    return `${formatDateCode(start)} - ${formatDateCode(end)}`;
  }
  return formatDateCode(start || end);
}

export default function WatchDetailSheet({
  watch,
  backendUrl,
  isAlarmLinked,
  isTesting,
  isDeleting,
  feedback,
  onTestAlarm,
  onDeleteWatch,
  onClose,
}) {
  const [venues, setVenues] = useState([]);
  const [loadingVenues, setLoadingVenues] = useState(false);
  const [venuesError, setVenuesError] = useState(null);

  useEffect(() => {
    if (!watch) {
      setVenues([]);
      setVenuesError(null);
      return;
    }

    let cancelled = false;
    setLoadingVenues(true);
    setVenuesError(null);

    getWatchVenues(backendUrl, watch._id)
      .then((data) => {
        if (cancelled) return;
        setVenues(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setVenuesError(err.message || 'Failed to load discovered theatres.');
      })
      .finally(() => {
        if (!cancelled) setLoadingVenues(false);
      });

    return () => {
      cancelled = true;
    };
  }, [watch, backendUrl]);

  const groupedVenues = useMemo(() => {
    return venues.reduce((acc, v) => {
      const key = v.date_code || 'General';
      if (!acc[key]) acc[key] = [];
      acc[key].push(v);
      return acc;
    }, {});
  }, [venues]);

  const handleConfirmDelete = () => {
    if (!watch) return;
    Alert.alert(
      'Delete Watch',
      `Remove "${watch.label || watch._id}" and stop monitoring its theatres?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Watch',
          style: 'destructive',
          onPress: () => onDeleteWatch(watch),
        },
      ]
    );
  };

  return (
    <Modal
      visible={Boolean(watch)}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>{watch?.label || ''}</Text>
              {Boolean(watch?.movie_name) && watch.movie_name !== watch.label && (
                <Text style={styles.subtitle}>{watch.movie_name}</Text>
              )}
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Metadata Summary */}
            <View style={styles.metaCard}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Format</Text>
                <Text style={styles.metaValue}>
                  {formatLanguageAndFormat(watch?.language, watch?.et_codes)}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Window</Text>
                <Text style={styles.metaValue}>
                  {formatDateRange(watch?.start_date, watch?.end_date)}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Interval</Text>
                <Text style={styles.metaValue}>
                  Every {watch?.interval_minutes || 10} min
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Watch ID</Text>
                <Text style={styles.metaCode}>{watch?._id}</Text>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.actionsRow}>
              {isAlarmLinked && (
                <TouchableOpacity
                  style={[styles.btnTest, isTesting && styles.btnDisabled]}
                  disabled={isTesting}
                  onPress={() => onTestAlarm(watch)}
                >
                  {isTesting ? (
                    <ActivityIndicator color={COLORS.textMain} size="small" />
                  ) : (
                    <Text style={styles.btnTestText}>Test Alarm</Text>
                  )}
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.btnDelete, isDeleting && styles.btnDisabled]}
                disabled={isDeleting}
                onPress={handleConfirmDelete}
              >
                {isDeleting ? (
                  <ActivityIndicator color={COLORS.danger} size="small" />
                ) : (
                  <Text style={styles.btnDeleteText}>Delete Watch</Text>
                )}
              </TouchableOpacity>
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

            {/* Discovered Theatres Grouped by Date */}
            <Text style={styles.sectionTitle}>
              Discovered Theatres ({venues.length})
            </Text>

            {loadingVenues ? (
              <View style={styles.centered}>
                <ActivityIndicator color={COLORS.crimson} size="small" />
                <Text style={styles.mutedText}>Loading seen theatres...</Text>
              </View>
            ) : venuesError ? (
              <View style={styles.feedbackError}>
                <Text style={styles.feedbackErrorText}>{venuesError}</Text>
              </View>
            ) : venues.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.mutedText}>
                  No theatres recorded yet. The poller logs theatres automatically as soon as shows open.
                </Text>
              </View>
            ) : (
              Object.entries(groupedVenues).map(([dateKey, list]) => (
                <View key={dateKey} style={styles.group}>
                  <View style={styles.groupHeader}>
                    <Text style={styles.groupHeaderText}>
                      Date: {formatDateCode(dateKey)} ({list.length}{' '}
                      {list.length === 1 ? 'Theatre' : 'Theatres'})
                    </Text>
                  </View>
                  {list.map((v, idx) => (
                    <View key={`${v.venue_code}-${idx}`} style={styles.venueRow}>
                      <Text style={styles.venueName}>{v.venue_name}</Text>
                      <Text style={styles.venueCode}>{v.venue_code}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bgCard,
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    borderTopWidth: 1,
    borderColor: COLORS.borderGlass,
    maxHeight: '88%',
    minHeight: '55%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGlass,
    gap: 12,
  },
  headerTitles: {
    flex: 1,
  },
  title: {
    color: COLORS.textMain,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeBtnText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    flexGrow: 1,
  },
  bodyContent: {
    padding: 18,
    paddingBottom: 30,
    gap: 14,
  },
  metaCard: {
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 12,
    gap: 7,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  metaLabel: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  metaCode: {
    color: COLORS.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnTest: {
    flex: 1,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnTestText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  btnDelete: {
    flex: 1,
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDeleteText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  feedbackBox: {
    borderRadius: RADII.sm,
    padding: 10,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: COLORS.emeraldSubtle,
    borderColor: COLORS.emeraldBorder,
  },
  feedbackError: {
    backgroundColor: COLORS.dangerSubtle,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    padding: 10,
    borderWidth: 1,
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
  sectionTitle: {
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  centered: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyCard: {
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 18,
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  group: {
    gap: 6,
  },
  groupHeader: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  groupHeaderText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  venueName: {
    flex: 1,
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '500',
  },
  venueCode: {
    color: COLORS.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 12,
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
