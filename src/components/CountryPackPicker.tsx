import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import GeoModule, { addGeoPackCompleteListener, addGeoPackErrorListener, addGeoPackProgressListener, isGeoModuleAvailable, type GeoPackPhase } from '../native/GeoModule';
import { countryNameForIso, listAvailableCountryPacks, type CountryPackListing } from '../services/OfflineGeocoder';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';
import { Radii, Shadows, Sizing, Spacing, Type } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface ProgressState {
  phase: GeoPackPhase;
  bytesDownloaded?: number;
  bytesTotal?: number;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatProgress(p: ProgressState): string {
  if (p.phase === 'extract') return 'Extracting…';
  if (p.phase === 'open') return 'Opening…';
  if (p.bytesTotal && p.bytesTotal > 0 && p.bytesDownloaded != null) {
    const pct = Math.round((p.bytesDownloaded / p.bytesTotal) * 100);
    return `${pct}%`;
  }
  return 'Downloading…';
}

/**
 * Country-pack picker — opened from the LOCATION group in VoiceRateControls.
 * Lists packs from the GitHub Releases API, marks installed ones, and runs
 * Install/Uninstall against GeoModule. Live progress comes from the native
 * module's `GeoPackProgress` events. Visual style mirrors VoiceRateControls.
 */
export function CountryPackPicker({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [available, setAvailable] = useState<CountryPackListing[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, ProgressState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refreshInstalled = useCallback(async () => {
    if (!isGeoModuleAvailable()) return;
    try {
      const rows = await GeoModule.installedCountryPacks();
      setInstalled(new Set(rows.map((r) => r.iso.toUpperCase())));
    } catch {
      // Non-fatal; keep last known state.
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([listAvailableCountryPacks(), refreshInstalled()])
      .then(([list]) => setAvailable(list))
      .finally(() => setLoading(false));
  }, [refreshInstalled, visible]);

  // Drop the progress entry for `iso` (used on completion/error/network fail).
  const clearProgress = useCallback((iso: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const subProgress = addGeoPackProgressListener((e) => {
      setProgress((prev) => ({
        ...prev,
        [e.iso.toUpperCase()]: {
          phase: e.phase, bytesDownloaded: e.bytesDownloaded, bytesTotal: e.bytesTotal,
        },
      }));
    });
    const subError = addGeoPackErrorListener((e) => {
      const iso = e.iso.toUpperCase();
      setErrors((prev) => ({ ...prev, [iso]: e.message }));
      clearProgress(iso);
    });
    const subComplete = addGeoPackCompleteListener((e) => {
      clearProgress(e.iso.toUpperCase());
      refreshInstalled();
    });
    return () => {
      subProgress.remove();
      subError.remove();
      subComplete.remove();
    };
  }, [clearProgress, refreshInstalled, visible]);

  const setError = useCallback((iso: string, err: unknown, fallback: string) => {
    setErrors((prev) => ({ ...prev, [iso]: err instanceof Error ? err.message : fallback }));
  }, []);

  const onInstall = useCallback((pack: CountryPackListing) => {
    if (!isGeoModuleAvailable()) return;
    setErrors((prev) => { const next = { ...prev }; delete next[pack.iso]; return next; });
    setProgress((prev) => ({ ...prev, [pack.iso]: { phase: 'download' } }));
    GeoModule.installCountryPack(pack.iso, pack.downloadUrl, pack.snapshotDate).catch((err: unknown) => {
      setError(pack.iso, err, 'Install failed');
      clearProgress(pack.iso);
    });
  }, [clearProgress, setError]);

  const onUninstall = useCallback((iso: string) => {
    if (!isGeoModuleAvailable()) return;
    GeoModule.uninstallCountryPack(iso).then(refreshInstalled).catch((err: unknown) => {
      setError(iso, err, 'Uninstall failed');
    });
  }, [refreshInstalled, setError]);

  const rows = useMemo(() => available, [available]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} hardwareAccelerated>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('narration.done')} />
        <View style={[styles.sheet, { paddingBottom: Spacing.lg + insets.bottom }]}>
          <View style={styles.handle} />
          <Text style={styles.heading}>Country detail packs</Text>
          <Text style={styles.subheading}>Download per-country place data for richer offline geocoding.</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {loading && rows.length === 0 ? (
              <View style={styles.emptyRow}>
                <ActivityIndicator color={Colors.primary} />
                <Text style={styles.emptyHint}>Looking up available packs…</Text>
              </View>
            ) : rows.length === 0 ? (
              <Text style={styles.emptyHint}>No packs available right now. Check your connection and try again.</Text>
            ) : (
              rows.map((pack) => (
                <PackRow
                  key={pack.iso.toUpperCase()}
                  pack={pack}
                  installed={installed.has(pack.iso.toUpperCase())}
                  progress={progress[pack.iso.toUpperCase()]}
                  error={errors[pack.iso.toUpperCase()]}
                  onInstall={onInstall}
                  onUninstall={onUninstall}
                />
              ))
            )}
          </ScrollView>
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>{t('narration.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function PackRow({
  pack, installed, progress, error, onInstall, onUninstall,
}: {
  pack: CountryPackListing;
  installed: boolean;
  progress: ProgressState | undefined;
  error: string | undefined;
  onInstall: (p: CountryPackListing) => void;
  onUninstall: (iso: string) => void;
}) {
  const iso = pack.iso.toUpperCase();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{pack.name || countryNameForIso(iso)}</Text>
        <Text style={styles.rowSub}>{iso} · {formatMb(pack.sizeBytes)} · {pack.snapshotDate}</Text>
        {error ? <Text style={styles.rowError}>{error}</Text> : null}
      </View>
      {progress ? (
        <View style={styles.statusBadge}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.statusText}>{formatProgress(progress)}</Text>
        </View>
      ) : installed ? (
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => onUninstall(iso)}>
          <Text style={styles.actionBtnTextDanger}>Remove</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.actionBtn} onPress={() => onInstall(pack)}>
          <Text style={styles.actionBtnText}>Install</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    // 78vh sheet — paddingBottom is added inline at render time so it picks
    // up the system gesture-nav inset and the Done button stays visible.
    height: '78%',
    maxHeight: Sizing.vh(85),
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
    borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, ...Shadows.softFloating,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.md,
  },
  heading: { ...Type.h1, color: Colors.text },
  subheading: { ...Type.bodySm, color: Colors.textTertiary, marginTop: 2, marginBottom: Spacing.md },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { gap: Spacing.sm, paddingBottom: Spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.borderLight,
    paddingVertical: 10, paddingHorizontal: 12, gap: 10,
  },
  rowText: { flex: 1 },
  rowLabel: { ...Type.body, fontFamily: 'Nunito_700Bold', color: Colors.text },
  rowSub: { ...Type.hint, color: Colors.textTertiary, marginTop: 1 },
  rowError: { ...Type.hint, color: Colors.error, marginTop: 2 },
  actionBtn: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radii.sm,
    backgroundColor: Colors.primary, ...Shadows.softOutset,
  },
  actionBtnText: { ...Type.chip, color: '#FFFFFF' },
  actionBtnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.error },
  actionBtnTextDanger: { ...Type.chip, color: Colors.error },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { ...Type.hint, color: Colors.textSecondary },
  emptyRow: { alignItems: 'center', gap: 8, paddingVertical: Spacing.lg },
  emptyHint: { ...Type.bodySm, color: Colors.textTertiary, textAlign: 'center' },
  doneBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radii.md,
    paddingVertical: 12, alignItems: 'center', ...Shadows.ctaHard,
  },
  doneBtnText: { ...Type.button, color: '#FFFFFF' },
});
