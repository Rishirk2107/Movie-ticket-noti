import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import { startAlarmLoop, stopAlarmLoop } from '../services/notifications';
import { loadCachedWatches } from '../services/storage';
import { formatDateCode } from '../utils/dateHelpers';
import { resolveAlarmBookingUrl } from '../utils/urlHelpers';

function AlarmOverlayBody({ alarmData, onDismiss }) {
  const [linkError, setLinkError] = useState(null);
  const [cachedWatches, setCachedWatches] = useState([]);

  const label = alarmData?.label || 'BookMyShow Ticket Alert';
  const dateDisplay = formatDateCode(alarmData?.date_code);
  const venues = Array.isArray(alarmData?.venues) ? alarmData.venues : [];

  useEffect(() => {
    let mounted = true;

    loadCachedWatches()
      .then((list) => {
        if (mounted && Array.isArray(list)) {
          setCachedWatches(list);
        }
      })
      .catch(() => {});

    startAlarmLoop();

    return () => {
      mounted = false;
    };
  }, [alarmData]);

  const handleStopAlarm = async () => {
    await stopAlarmLoop();
    onDismiss();
  };

  const handleBookOnBMS = async () => {
    setLinkError(null);
    const normalizedUrl = resolveAlarmBookingUrl(alarmData, cachedWatches);

    try {
      await Linking.openURL(normalizedUrl);
      await stopAlarmLoop();
      onDismiss();
    } catch (err) {
      const detail = err?.message ? ` (${err.message})` : '';
      setLinkError(
        `Could not open BookMyShow automatically${detail}. Open this URL in your browser: ${normalizedUrl}`
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <View style={[styles.topBanner, SHADOWS.crimsonGlow]}>
          <Text style={styles.alertTag}>EMERGENCY TICKET ALARM</Text>
          <Text style={styles.movieLabel}>{label}</Text>
          <View style={styles.dateChip}>
            <Text style={styles.dateChipText}>DATE: {dateDisplay}</Text>
          </View>
        </View>

        <View style={[styles.venuesCard, SHADOWS.card]}>
          <Text style={styles.venuesHeading}>
            Newly Opened Theatres ({venues.length})
          </Text>
          <ScrollView
            style={styles.venuesScroll}
            contentContainerStyle={styles.venuesContent}
          >
            {venues.length === 0 ? (
              <Text style={styles.emptyVenues}>
                New theatre availability detected. Tap Book on BookMyShow to view live showtimes.
              </Text>
            ) : (
              venues.map((v, idx) => {
                const name =
                  typeof v === 'string'
                    ? v
                    : v?.name || v?.venue_name || 'Theatre';
                const code =
                  typeof v === 'object' ? v?.code || v?.venue_code || '' : '';
                return (
                  <View key={`${code}-${idx}`} style={styles.venueRow}>
                    <Text style={styles.venueName}>{name}</Text>
                    {Boolean(code) && <Text style={styles.venueCode}>{code}</Text>}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        {linkError && (
          <View style={styles.errorBox}>
            <Text selectable style={styles.errorText}>
              {linkError}
            </Text>
          </View>
        )}

        <View style={styles.controls}>
          <TouchableOpacity style={styles.bookBtn} onPress={handleBookOnBMS}>
            <Text style={styles.bookBtnText}>Book on BookMyShow</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.stopBtn} onPress={handleStopAlarm}>
            <Text style={styles.stopBtnText}>Stop Alarm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function ActiveAlarmOverlay({ alarmData, onDismiss }) {
  const handleRequestClose = async () => {
    await stopAlarmLoop();
    onDismiss();
  };

  return (
    <Modal
      visible={Boolean(alarmData)}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleRequestClose}
    >
      {alarmData ? (
        <AlarmOverlayBody alarmData={alarmData} onDismiss={onDismiss} />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
    padding: 20,
    justifyContent: 'space-between',
  },
  topBanner: {
    backgroundColor: COLORS.crimsonSubtle,
    borderWidth: 1,
    borderColor: COLORS.crimsonBorder,
    borderRadius: RADII.lg,
    padding: 20,
    alignItems: 'center',
  },
  alertTag: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  movieLabel: {
    color: COLORS.textMain,
    fontSize: 23,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  dateChip: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADII.full,
  },
  dateChipText: {
    color: COLORS.emerald,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  venuesCard: {
    flex: 1,
    marginVertical: 16,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.lg,
    padding: 16,
  },
  venuesHeading: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 12,
  },
  venuesScroll: {
    flex: 1,
  },
  venuesContent: {
    gap: 8,
  },
  emptyVenues: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  venueName: {
    flex: 1,
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '600',
  },
  venueCode: {
    color: COLORS.textMain,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: COLORS.bgBase,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  errorBox: {
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  controls: {
    gap: 12,
  },
  bookBtn: {
    backgroundColor: COLORS.emerald,
    borderRadius: RADII.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  bookBtnText: {
    color: '#032318',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  stopBtn: {
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stopBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
