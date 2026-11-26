import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { linkDevice, triggerTestAlarm, unlinkDevice } from '../services/api';
import { saveSettings } from '../services/storage';

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
  const [busyAction, setBusyAction] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const validateInputs = (requireToken = false) => {
    if (!backendUrl.trim()) {
      setFeedback({ type: 'error', message: 'Enter your backend URL first.' });
      return false;
    }
    if (!watchId.trim()) {
      setFeedback({ type: 'error', message: 'Enter a Watch ID from the web dashboard.' });
      return false;
    }
    if (requireToken && !pushToken) {
      setFeedback({
        type: 'error',
        message: tokenError || 'Push token is not ready yet.',
      });
      return false;
    }
    return true;
  };

  const handleSaveInputs = async (nextLinked = isLinked) => {
    await saveSettings({
      backendUrl,
      watchId,
      isLinked: nextLinked,
    });
  };

  const handleLink = async () => {
    if (!validateInputs(true)) return;
    setBusyAction('link');
    setFeedback(null);
    try {
      const devices = await linkDevice(backendUrl, watchId, pushToken);
      setIsLinked(true);
      await handleSaveInputs(true);
      const count = Array.isArray(devices) ? devices.length : 1;
      setFeedback({
        type: 'success',
        message: `Device linked to watch ${watchId.trim()} (${count} linked ${count === 1 ? 'device' : 'devices'}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to link device.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnlink = async () => {
    if (!validateInputs(true)) return;
    setBusyAction('unlink');
    setFeedback(null);
    try {
      await unlinkDevice(backendUrl, watchId, pushToken);
      setIsLinked(false);
      await handleSaveInputs(false);
      setFeedback({
        type: 'success',
        message: `Device unlinked from watch ${watchId.trim()}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to unlink device.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestAlarm = async () => {
    if (!validateInputs(false)) return;
    setBusyAction('test');
    setFeedback(null);
    try {
      await handleSaveInputs(isLinked);
      const res = await triggerTestAlarm(backendUrl, watchId);
      const tickets = Array.isArray(res?.data)
        ? res.data
        : res?.data
          ? [res.data]
          : [];
      const failed = tickets.find((t) => t?.status === 'error');
      if (failed) {
        setFeedback({
          type: 'error',
          message: failed.message || 'Push service reported a delivery error.',
        });
      } else {
        setFeedback({
          type: 'success',
          message: 'Test alarm dispatched. The alarm notification should arrive shortly.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to trigger test alarm.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>TICKET ALARM COMPANION</Text>
        </View>
        <Text style={styles.title}>Watch Linker & Controls</Text>
        <Text style={styles.subtitle}>
          Connect this Android device to a BookMyShow Watch ID to sound a loud alarm the moment new theatres open.
        </Text>
      </View>

      {/* Connection Settings Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Backend & Watch Configuration</Text>

        <Text style={styles.label}>BACKEND BASE URL</Text>
        <TextInput
          style={styles.input}
          value={backendUrl}
          onChangeText={(val) => {
            setBackendUrl(val);
            saveSettings({ backendUrl: val });
          }}
          placeholder="http://192.168.1.10:8000 or https://..."
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

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

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Link Status</Text>
          <View style={[styles.statusPill, isLinked ? styles.pillActive : styles.pillIdle]}>
            <View style={[styles.statusDot, isLinked ? styles.dotActive : styles.dotIdle]} />
            <Text style={[styles.statusText, isLinked ? styles.textActive : styles.textIdle]}>
              {isLinked ? 'Linked' : 'Not Linked'}
            </Text>
          </View>
        </View>
      </View>

      {/* Push Token Card */}
      <View style={styles.card}>
        <View style={styles.tokenHeader}>
          <Text style={styles.sectionTitle}>Device Push Token</Text>
          {!pushToken && (
            <TouchableOpacity onPress={onRetryToken} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>

        {pushToken ? (
          <Text selectable style={styles.tokenBox}>
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

      {/* Controls */}
      <View style={styles.actionsCard}>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, busyAction && styles.btnDisabled]}
            disabled={Boolean(busyAction)}
            onPress={handleLink}
          >
            {busyAction === 'link' ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>Link Device</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnOutlineDanger, busyAction && styles.btnDisabled]}
            disabled={Boolean(busyAction)}
            onPress={handleUnlink}
          >
            {busyAction === 'unlink' ? (
              <ActivityIndicator color="#f87171" size="small" />
            ) : (
              <Text style={styles.btnOutlineDangerText}>Unlink Device</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, busyAction && styles.btnDisabled]}
          disabled={Boolean(busyAction)}
          onPress={handleTestAlarm}
        >
          {busyAction === 'test' ? (
            <ActivityIndicator color="#f9fafb" size="small" />
          ) : (
            <Text style={styles.btnSecondaryText}>Test Alarm (Send Push)</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={onOpenTestPreview}
        >
          <Text style={styles.btnGhostText}>Preview Local Alarm Screen</Text>
        </TouchableOpacity>

        {feedback && (
          <View
            style={[
              styles.feedbackBox,
              feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError,
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
    marginBottom: 4,
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
    fontSize: 26,
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
  actionsCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
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
    paddingVertical: 11,
    color: '#f9fafb',
    fontSize: 14,
    marginBottom: 14,
  },
  monoInput: {
    fontFamily: 'monospace',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  statusLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
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
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#34d399',
  },
  dotIdle: {
    backgroundColor: '#9ca3af',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  textActive: {
    color: '#34d399',
  },
  textIdle: {
    color: '#9ca3af',
  },
  tokenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retryBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
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
    padding: 12,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  tokenErrorBox: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
    borderRadius: 8,
    padding: 12,
  },
  tokenErrorText: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
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
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  btnSecondaryText: {
    color: '#f9fafb',
    fontSize: 14,
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
    padding: 12,
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
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackErrorText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '600',
  },
});
