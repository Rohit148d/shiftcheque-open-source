/** Backup: export, share, import with merge/replace + a safety snapshot (spec 77). */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { BACKUP_FILE_EXTENSION, BRAND } from '../../config/brand.ts';
import { exportBackup, importBackup, listLocalBackups, pickBackupFile, shareBackup, type ImportPreview } from '../../services/backup.ts';
import { track } from '../../services/analytics.ts';
import { useAppStore } from '../../state/store.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, BottomSheet, Button, Caption, Card, ListRow, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function BackupSettings() {
  const { t, day } = useAppUi();
  const reload = useAppStore((state) => state.reload);
  const [files, setFiles] = useState<{ name: string; uri: string; sizeBytes: number }[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void listLocalBackups().then(setFiles);
  useEffect(refresh, []);

  const doExport = async () => {
    setBusy(true);
    const result = await exportBackup();
    setBusy(false);
    if (result.status === 'exported') {
      setStatus(`Saved ${result.fileName}`);
      track('backup_created');
      refresh();
      void shareBackup(result.path);
    } else {
      setStatus(`Export failed: ${result.reason}`);
    }
  };

  const doPick = async () => {
    const result = await pickBackupFile();
    if (result.status === 'picked') setPreview(result.preview);
    else if (result.status === 'invalid') setStatus(result.reason);
  };

  const doImport = async (mode: 'merge' | 'replace') => {
    if (!preview) return;
    setBusy(true);
    const result = await importBackup(preview, mode);
    setBusy(false);
    setPreview(null);
    if (result.status === 'imported') {
      await reload();
      setStatus(`Imported ${result.rows} rows (${mode})${result.safetyBackupPath ? ' • safety backup created first' : ''}`);
      refresh();
    } else {
      setStatus(`Import failed: ${result.reason}`);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('settings.backup')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      {status ? <Banner tone="info" body={status} onDismiss={() => setStatus(null)} /> : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Export</SectionTitle>
        <Body muted>
          Creates a complete, versioned {BACKUP_FILE_EXTENSION} file with your jobs, shifts, rates and settings.
        </Body>
        <Button label="Export backup" onPress={() => void doExport()} loading={busy} />
        <Caption>
          The file is not encrypted in this version — keep it somewhere private, like your own device or a password-protected cloud folder.
        </Caption>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Import</SectionTitle>
        <Body muted>Choose a backup file, then merge it with what you have or replace everything.</Body>
        <Button label="Choose a backup file" variant="secondary" onPress={() => void doPick()} />
      </Card>

      {files.length > 0 ? (
        <Card style={{ gap: 0 }}>
          <SectionTitle>On this device</SectionTitle>
          {files.slice(0, 5).map((file) => (
            <ListRow
              key={file.uri}
              icon="document-outline"
              title={file.name}
              subtitle={`${(file.sizeBytes / 1024).toFixed(0)} KB`}
              onPress={() => void shareBackup(file.uri)}
            />
          ))}
        </Card>
      ) : null}

      <Caption>{BRAND.APP_NAME} never uploads your data. Backups only leave the device when you share them.</Caption>

      <BottomSheet
        visible={preview !== null}
        onClose={() => setPreview(null)}
        title="Import backup"
        primaryAction={{ label: 'Merge with my data', onPress: () => void doImport('merge') }}
        secondaryAction={{ label: 'Replace everything', onPress: () => void doImport('replace') }}
      >
        {preview ? (
          <View style={{ gap: spacing.sm }}>
            <Body>{preview.fileName}</Body>
            <Caption>Exported {day(preview.document.exportedAt.slice(0, 10), 'long')} by {preview.document.appName}</Caption>
            {Object.entries(preview.counts).map(([table, count]) => (
              <View key={table} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Caption>{table}</Caption>
                <Caption>{String(count)}</Caption>
              </View>
            ))}
            <Banner tone="attention" body="Replacing deletes your current data. We take a safety backup first when we can." />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
