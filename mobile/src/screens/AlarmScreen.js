import React, { useEffect, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

const ALARM_SOUND = require('../../assets/alarm.wav');

function formatDateCode(dateCode) {
  if (!dateCode || typeof dateCode !== 'string') return 'Selected Dates';
  const clean = dateCode.trim();
  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean;
}

export default function AlarmScreen({ alarmData, onDismiss }) {
  const player = useAudioPlayer(ALARM_SOUND);
  const [linkError, setLinkError] = useState(null);

  const label = alarmData?.label || 'BookMyShow Ticket Alert';
  const dateDisplay = formatDateCode(alarmData?.date_code);
  const venues = Array.isArray(alarmData?.venues) ? alarmData.venues : [];
  const showtimesUrl = alarmData?.showtimes_url || '';

  useEffect(() => {
    let isMounted = true;

    async function startAlarmPlayback() {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        });
      } catch {
        // Proceed even if audio mode configuration is restricted
      }

      if (!isMounted) return;
      try {
        player.loop = true;
        player.volume = 1.0;
        player.play();
      } catch {
        // Ignore player errors if already unmounted
      }

      Vibration.vibrate([0, 600, 300], true);
    }

    startAlarmPlayback();

    return () => {
      isMounted = false;
      Vibration.cancel();
      try {
        player.pause();
      } catch {
        // Player may already be released on unmount
      }
    };
  }, [player]);

  const stopAlarmOutput = async () => {
    Vibration.cancel();
    try {
      player.pause();
      await player.seekTo(0);
    } catch {
      // Ignore cleanup errors
    }
  };

  const handleStopAlarm = async () => {
    await stopAlarmOutput();
    onDismiss();
  };

  const handleBookTickets = async () => {
    setLinkError(null);
    await stopAlarmOutput();
    if (!showtimesUrl) {
      setLinkError('No showtimes URL was included in this alert.');
      return;
    }
    try {
      const supported = await Linking.canOpenURL(showtimesUrl);
      if (!supported) {
        setLinkError('Unable to open showtimes link on this device.');
        return;
      }
      await Linking.openURL(showtimesUrl);
      onDismiss();
    } catch (err) {
      setLinkError(err.message || 'Failed to open BookMyShow.');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topAlertBanner}>
        <Text style={styles.alertTag}>TICKETS OPEN NOW</Text>
        <Text style={styles.movieLabel}>{label}</Text>
        <View style={styles.dateChip}>
          <Text style={styles.dateChipText}>DATE: {dateDisplay}</Text>
        </View>
      </View>

      <View style={styles.venuesCard}>
        <Text style={styles.venuesHeading}>
          Newly Opened Theatres ({venues.length})
        </Text>
        <ScrollView style={styles.venuesList} contentContainerStyle={styles.venuesListContent}>
          {venues.length === 0 ? (
            <Text style={styles.emptyVenues}>
              New theatre availability detected. Tap Book Tickets to view showtimes.
            </Text>
          ) : (
            venues.map((v, index) => {
              const name =
                typeof v === 'string'
                  ? v
                  : v?.name || v?.venue_name || 'Theatre';
              const code =
                typeof v === 'object' ? v?.code || v?.venue_code || '' : '';
              return (
                <View key={`${code}-${index}`} style={styles.venueRow}>
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
        <TouchableOpacity style={styles.bookBtn} onPress={handleBookTickets}>
          <Text style={styles.bookBtnText}>Book Tickets</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.stopBtn} onPress={handleStopAlarm}>
          <Text style={styles.stopBtnText}>Stop Alarm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b0f19',
    padding: 20,
    justifyContent: 'space-between',
  },
  topAlertBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  alertTag: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  movieLabel: {
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  dateChip: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dateChipText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  venuesCard: {
    flex: 1,
    marginVertical: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    padding: 16,
  },
  venuesHeading: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 12,
  },
  venuesList: {
    flex: 1,
  },
  venuesListContent: {
    gap: 8,
  },
  emptyVenues: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  venueName: {
    flex: 1,
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '600',
  },
  venueCode: {
    color: '#cbd5e1',
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#0b0f19',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  errorBox: {
    backgroundColor: 'rgba(248, 113, 113, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  controls: {
    gap: 12,
  },
  bookBtn: {
    backgroundColor: '#34d399',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  bookBtnText: {
    color: '#06281c',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  stopBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stopBtnText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
