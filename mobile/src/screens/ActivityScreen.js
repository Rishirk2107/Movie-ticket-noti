import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import {
  getHealth,
  getLogs,
  linkDevice,
  triggerTestAlarm,
  unlinkDevice,
} from '../services/api';
import { saveSettings } from '../services/storage';
import { isValidHttpUrl } from '../utils/dateHelpers';

const LOG_LEVELS = ['ALL', 'SUCCESS', 'INFO', 'WARN', 'ERROR'];

function levelColors(level) {
  switch ((level || '').toUpperCase()) {
    case 'SUCCESS':
      return { color: COLORS.emerald, bg: COLORS.emeraldSubtle };
    case 'ERROR':
      return { color: COLORS.danger, bg: COLORS.dangerSubtle };
    case 'WARN':
      return { color: COLORS.amber, bg: COLORS.amberSubtle };
    default:
      return { color: COLORS.cyan, bg: COLORS.cyanSubtle };
  }
}

export default function ActivityScreen({
  backendUrl,
  onChangeBackendUrl,
  watchId,
  onChangeWatchId,
  pushToken,
  tokenError,
  onRetryToken,
  onHealthUpdate,
  onWatchesChanged,
  onOpenAlarmPreview,
  isActive,
}) {
  const [urlDraft, setUrlDraft] = useState(backendUrl || '');
  const [testingHealth, setTestingHealth] = useState(false);
  const [healthInfo, setHealthInfo] = useState(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(null);
  const [manualFeedback, setManualFeedback] = useState(null);

  const [logs, setLogs] = useState([]);
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [paused, setPaused] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(null);

  useEffect(() => {
    setUrlDraft(backendUrl || '');
  }, [backendUrl]);

  const checkHealth = useCallback(
    async (targetUrl) => {
      const clean = (targetUrl || '').trim();
      if (!isValidHttpUrl(clean)) {
        setHealthInfo({ ok: false, label: 'Invalid URL' });
        onHealthUpdate?.(false);
        return;
      }
      setTestingHealth(true);
      try {
        const res = await getHealth(clean);
        setHealthInfo({
          ok: true,
          label: `Online • ${res.active_watches ?? 0} watches`,
        });
        onHealthUpdate?.(true);
      } catch (err) {
        setHealthInfo({
          ok: false,
          label: err.message || 'Unreachable',
        });
        onHealthUpdate?.(false);
      } finally {
        setTestingHealth(false);
      }
    },
    [onHealthUpdate]
  );

  const loadLogs = useCallback(
    async ({ showSpinner = false } = {}) => {
      if (!isValidHttpUrl(backendUrl)) {
        setLogsError('Configure a valid Backend Base URL above.');
        return;
      }
      if (showSpinner) setLoadingLogs(true);
      setLogsError(null);
      try {
        const res = await getLogs(backendUrl, 50);
        setLogs(Array.isArray(res?.logs) ? res.logs : []);
      } catch (err) {
        setLogsError(err.message || 'Unable to fetch logs.');
      } finally {
        if (showSpinner) setLoadingLogs(false);
      }
    },
    [backendUrl]
  );

  useEffect(() => {
    if (!isActive) return;
    checkHealth(backendUrl);
    loadLogs({ showSpinner: logs.length === 0 });
    if (paused) return;

    const timer = setInterval(() => {
      loadLogs({ showSpinner: false });
    }, 5000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, paused, backendUrl]);

  const handleSaveUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!isValidHttpUrl(trimmed)) {
      setHealthInfo({ ok: false, label: 'Enter a valid http:// or https:// URL' });
      return;
    }
    onChangeBackendUrl(trimmed);
    await saveSettings({ backendUrl: trimmed });
    await checkHealth(trimmed);
    onWatchesChanged?.();
  };

  const handleShareToken = async () => {
    if (!pushToken) return;
    try {
      await Share.share({ message: pushToken });
    } catch {
      // Ignore cancellation
    }
  };

  const handleManualAction = async (action) => {
    const targetUrl = urlDraft.trim() || backendUrl.trim();
    const targetWatch = watchId.trim();
    if (!isValidHttpUrl(targetUrl)) {
      setManualFeedback({ type: 'error', message: 'Save a valid Backend URL first.' });
      return;
    }
    if (!targetWatch) {
      setManualFeedback({ type: 'error', message: 'Enter a Watch ID.' });
      return;
    }
    if ((action === 'link' || action === 'unlink') && !pushToken) {
      setManualFeedback({
        type: 'error',
        message: tokenError || 'Device push token is not ready.',
      });
      return;
    }

    setManualBusy(action);
    setManualFeedback(null);
    try {
      await saveSettings({ watchId: targetWatch });
      if (action === 'link') {
        await linkDevice(targetUrl, targetWatch, pushToken);
        setManualFeedback({
          type: 'success',
          message: `Linked device to watch ${targetWatch}.`,
        });
        onWatchesChanged?.();
      } else if (action === 'unlink') {
        await unlinkDevice(targetUrl, targetWatch, pushToken);
        setManualFeedback({
          type: 'success',
          message: `Unlinked device from watch ${targetWatch}.`,
        });
        onWatchesChanged?.();
      } else {
        await triggerTestAlarm(targetUrl, targetWatch);
        setManualFeedback({
          type: 'success',
          message: `Test alarm dispatched for watch ${targetWatch}.`,
        });
      }
    } catch (err) {
      setManualFeedback({ type: 'error', message: err.message || 'Action failed.' });
    } finally {
      setManualBusy(null);
    }
  };

  const filteredLogs = useMemo(() => {
    if (filterLevel === 'ALL') return logs;
    return logs.filter((l) => (l.level || '').toUpperCase() === filterLevel);
  }, [logs, filterLevel]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerBlock}>
        <Text style={styles.kicker}>TELEMETRY & CONNECTION</Text>
        <Text style={styles.pageTitle}>Activity</Text>
      </View>

      {/* System & Connection Card */}
      <View style={[styles.card, SHADOWS.card]}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>System & Connection</Text>
          <View
            style={[
              styles.healthPill,
              healthInfo?.ok ? styles.healthOk : styles.healthWarn,
            ]}
          >
            <View
              style={[
                styles.healthDot,
                healthInfo?.ok ? styles.dotOk : styles.dotWarn,
              ]}
            />
            <Text
              style={[
                styles.healthText,
                healthInfo?.ok ? styles.healthTextOk : styles.healthTextWarn,
              ]}
            >
              {testingHealth
                ? 'Checking...'
                : healthInfo?.label || 'Tap Save / Test'}
            </Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>BACKEND BASE URL</Text>
        <View style={styles.inlineRow}>
          <TextInput
            style={[styles.input, styles.flexInput]}
            value={urlDraft}
            onChangeText={setUrlDraft}
            placeholder="https://movie-ticket-noti.onrender.com"
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSaveUrl}
            disabled={testingHealth}
          >
            <Text style={styles.saveBtnText}>Save / Test</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.rowBetween, { marginTop: 4 }]}>
          <Text style={styles.fieldLabel}>DEVICE PUSH TOKEN</Text>
          {pushToken ? (
            <TouchableOpacity style={styles.smallBtn} onPress={handleShareToken}>
              <Text style={styles.smallBtnText}>Copy / Share</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.smallBtn} onPress={onRetryToken}>
              <Text style={styles.smallBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>

        {pushToken ? (
          <Text selectable style={styles.tokenBox}>
            {pushToken}
          </Text>
        ) : (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              {tokenError || 'Waiting for notification permissions...'}
            </Text>
          </View>
        )}

        {/* Collapsible Link by Watch ID */}
        <TouchableOpacity
          style={styles.collapseHeader}
          onPress={() => setManualOpen((prev) => !prev)}
        >
          <Text style={styles.collapseTitle}>Link by Watch ID</Text>
          <Text style={styles.collapseToggle}>{manualOpen ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>

        {manualOpen && (
          <View style={styles.collapseBody}>
            <TextInput
              style={[styles.input, styles.monoInput]}
              value={watchId}
              onChangeText={(val) => {
                onChangeWatchId(val);
                saveSettings({ watchId: val });
              }}
              placeholder="e.g. 8d66eee0"
              placeholderTextColor={COLORS.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.inlineRow}>
              <TouchableOpacity
                style={[styles.btnFlexPrimary, manualBusy && styles.btnDisabled]}
                disabled={Boolean(manualBusy)}
                onPress={() => handleManualAction('link')}
              >
                {manualBusy === 'link' ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Link</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnFlexDanger, manualBusy && styles.btnDisabled]}
                disabled={Boolean(manualBusy)}
                onPress={() => handleManualAction('unlink')}
              >
                {manualBusy === 'unlink' ? (
                  <ActivityIndicator color={COLORS.danger} size="small" />
                ) : (
                  <Text style={styles.btnDangerText}>Unlink</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnFlexSecondary, manualBusy && styles.btnDisabled]}
                disabled={Boolean(manualBusy)}
                onPress={() => handleManualAction('test')}
              >
                {manualBusy === 'test' ? (
                  <ActivityIndicator color={COLORS.textMain} size="small" />
                ) : (
                  <Text style={styles.btnSecondaryText}>Test</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.previewBtn} onPress={onOpenAlarmPreview}>
              <Text style={styles.previewBtnText}>Preview Alarm Overlay</Text>
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

      {/* Live Poller Logs Terminal */}
      <View style={[styles.terminalCard, SHADOWS.card]}>
        <View style={styles.terminalTop}>
          <View>
            <Text style={styles.cardTitle}>Live Poller Logs</Text>
            <Text style={styles.terminalSub}>
              {paused ? 'Paused' : 'Auto-refreshing every 5s'}
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => setPaused((p) => !p)}
            >
              <Text style={styles.smallBtnText}>{paused ? 'Resume' : 'Pause'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => loadLogs({ showSpinner: true })}
            >
              <Text style={styles.smallBtnText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {LOG_LEVELS.map((lvl) => {
            const active = filterLevel === lvl;
            return (
              <TouchableOpacity
                key={lvl}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilterLevel(lvl)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {lvl}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {Boolean(logsError) && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{logsError}</Text>
          </View>
        )}

        <View style={styles.terminalScreen}>
          {loadingLogs && logs.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color={COLORS.crimson} size="small" />
              <Text style={styles.mutedText}>Fetching activity logs...</Text>
            </View>
          ) : filteredLogs.length === 0 ? (
            <Text style={styles.mutedText}>No log entries available.</Text>
          ) : (
            filteredLogs.map((entry, idx) => {
              const badge = levelColors(entry.level);
              return (
                <View key={`${entry.timestamp}-${idx}`} style={styles.logLine}>
                  <View style={styles.logMeta}>
                    <Text style={styles.logTs}>{entry.timestamp}</Text>
                    <View style={[styles.lvlBadge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.lvlText, { color: badge.color }]}>
                        {entry.level}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.logMsg}>{entry.message}</Text>
                </View>
              );
            })
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
  container: {
    padding: 16,
    paddingBottom: 98,
    gap: 14,
  },
  headerBlock: {
    gap: 2,
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
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 15,
    gap: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '700',
  },
  healthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADII.full,
    borderWidth: 1,
  },
  healthOk: {
    backgroundColor: COLORS.emeraldSubtle,
    borderColor: COLORS.emeraldBorder,
  },
  healthWarn: {
    backgroundColor: COLORS.amberSubtle,
    borderColor: COLORS.amberBorder,
  },
  healthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOk: {
    backgroundColor: COLORS.emerald,
  },
  dotWarn: {
    backgroundColor: COLORS.amber,
  },
  healthText: {
    fontSize: 11,
    fontWeight: '700',
  },
  healthTextOk: {
    color: COLORS.emerald,
  },
  healthTextWarn: {
    color: COLORS.amber,
  },
  fieldLabel: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  input: {
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 11,
    paddingVertical: 9,
    color: COLORS.textMain,
    fontSize: 13,
  },
  monoInput: {
    fontFamily: MONO_FONT,
  },
  saveBtn: {
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  smallBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  smallBtnText: {
    color: COLORS.textMain,
    fontSize: 11,
    fontWeight: '700',
  },
  tokenBox: {
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    padding: 10,
    color: COLORS.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 11,
    lineHeight: 16,
  },
  warnBox: {
    backgroundColor: COLORS.amberSubtle,
    borderWidth: 1,
    borderColor: COLORS.amberBorder,
    borderRadius: RADII.sm,
    padding: 10,
  },
  warnText: {
    color: COLORS.amber,
    fontSize: 12,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderGlass,
  },
  collapseTitle: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  collapseToggle: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  collapseBody: {
    gap: 10,
    paddingTop: 4,
  },
  btnFlexPrimary: {
    flex: 1,
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnFlexDanger: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnFlexSecondary: {
    flex: 1,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  btnDangerText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  btnSecondaryText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  previewBtn: {
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingVertical: 9,
    alignItems: 'center',
  },
  previewBtnText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.55,
  },
  feedbackBox: {
    borderRadius: RADII.sm,
    padding: 9,
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
  terminalCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 15,
    gap: 10,
  },
  terminalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  terminalSub: {
    color: COLORS.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  filterRow: {
    gap: 6,
  },
  filterChip: {
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterChipActive: {
    backgroundColor: COLORS.textMain,
    borderColor: COLORS.textMain,
  },
  filterChipText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: COLORS.bgBase,
  },
  errorBox: {
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    padding: 10,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  terminalScreen: {
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    padding: 12,
    gap: 8,
  },
  centered: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  logLine: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    paddingBottom: 7,
    gap: 4,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logTs: {
    color: COLORS.textDim,
    fontFamily: MONO_FONT,
    fontSize: 11,
  },
  lvlBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lvlText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '800',
  },
  logMsg: {
    color: COLORS.textMain,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 17,
  },
});
