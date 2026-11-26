import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useAudioPlayer } from 'expo-audio';

import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import {
  ALARM_SOUND_ASSET,
  configureAlarmAudioMode,
  startLoopingAlarmPlayback,
  stopLoopingAlarmPlayback,
} from '../services/notifications';
import { formatDateCode } from '../utils/dateHelpers';

function AlarmOverlayBody({ alarmData, onDismiss }) {
  const player = useAudioPlayer(ALARM_SOUND_ASSET);
  const [linkError, setLinkError] = useState(null);

  const label = alarmData?.label || 'BookMyShow Ticket Alert';
  const dateDisplay = formatDateCode(alarmData?.date_code);
  const venues = Array.isArray(alarmData?.venues) ? alarmData.venues : [];
  const showtimesUrl = alarmData?.showtimes_url || '';

  useEffect(() => {
    let mounted = true;

    async function beginAlarm() {
      await configureAlarmAudioMode();
      if (!mounted) return;
      startLoopingAlarmPlayback(player);
    }

    beginAlarm();

    return () => {
      mounted = false;
      Vibration.cancel();
      try {
        player.pause();
      } catch {
        // Player already released on unmount
      }
    };
  }, [player]);

  const handleStopAlarm = async () => {
    await stopLoopingAlarmPlayback(player);
    onDismiss();
  };

  const handleBookOnBMS = async () => {
    setLinkError(null);
    await stopLoopingAlarmPlayback(player);
    if (!showtimesUrl) {
      setLinkError('No BookMyShow showtimes URL was included in this alert.');
      return;
    }
    try {
      const supported = await Linking.canOpenURL(showtimesUrl);
      if (!supported) {
        setLinkError('Unable to open BookMyShow link on this device.');
        return;
      }
      await Linking.openURL(showtimesUrl);
      onDismiss();
    } catch (err) {
      setLinkError(err.message || 'Failed to open BookMyShow.');
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
            <Text style={styles.errorText}>{linkError}</Text>
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
  return (
    <Modal
      visible={Boolean(alarmData)}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onDismiss}
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
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
