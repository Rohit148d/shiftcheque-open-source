/**
 * Backup export / import (spec 77).
 *
 * The export is a versioned JSON document with a brand-aware extension. Imports
 * are validated before anything is written; destructive "replace" imports take
 * a safety snapshot first when the file system allows it.
 *
 * ENCRYPTION: passphrase encryption is deliberately NOT implemented in V1.
 * Rolling our own crypto would be worse than none; the UI says so plainly and
 * tells people to store the file somewhere safe. See docs/PRIVACY_DATA_MAP.md.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';
import { z } from 'zod';

import { BACKUP_FILE_EXTENSION, BRAND } from '../config/brand.ts';
import { SCHEMA_VERSION } from '../db/schema.ts';
import { allSql, execSql } from '../db/database.ts';
import { BackupRepository, wipeAllData } from '../db/repositories.ts';

const BackupDocumentSchema = z.object({
  format: z.enum([BRAND.BACKUP_FORMAT, ...BRAND.LEGACY_BACKUP_FORMATS]),
  formatVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  appName: z.string(),
  exportedAt: z.string(),
  encrypted: z.boolean(),
  counts: z.record(z.string(), z.number()),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))),
});

export type BackupDocument = z.infer<typeof BackupDocumentSchema>;

const BACKUP_TABLES = [
  'jobs',
  'rate_history',
  'overtime_rules',
  'premium_rules',
  'shift_templates',
  'shift_patterns',
  'shifts',
  'shift_breaks',
  'deduction_profiles',
  'actual_paycheques',
  'actual_paycheque_lines',
  'app_settings',
  'notification_settings',
  'rule_overrides',
  'job_setting_changes',
  'backup_metadata',
] as const;

export async function buildBackupDocument(): Promise<BackupDocument> {
  const tables: Record<string, Record<string, string | number | null>[]> = {};
  const counts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const rows = await allSql<Record<string, string | number | null>>(`SELECT * FROM ${table}`);
    tables[table] = rows;
    counts[table] = rows.length;
  }
  return {
    format: BRAND.BACKUP_FORMAT,
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    appName: BRAND.APP_NAME,
    exportedAt: new Date().toISOString(),
    encrypted: false,
    counts,
    tables,
  };
}

export function backupFileName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${BRAND.APP_NAME.toLowerCase()}-backup-${stamp}${BACKUP_FILE_EXTENSION}`;
}

export type ExportResult = { status: 'exported'; fileName: string; path: string } | { status: 'failed'; reason: string };

export async function exportBackup(): Promise<ExportResult> {
  try {
    const document = await buildBackupDocument();
    const json = JSON.stringify(document, null, 2);
    const fileName = backupFileName();
    const file = new File(Paths.document, fileName);
    file.create({ overwrite: true });
    file.write(json);
    await BackupRepository.record({
      fileName,
      sizeBytes: json.length,
      encrypted: false,
      schemaVersion: SCHEMA_VERSION,
      summaryJson: JSON.stringify(document.counts),
    });
    return { status: 'exported', fileName, path: file.uri };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function shareBackup(path: string): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: `Save ${BRAND.APP_NAME} backup` });
        return;
      }
    }
    await Share.share({ url: path, message: `${BRAND.APP_NAME} backup file` });
  } catch {
    // sharing is optional
  }
}

export type ImportPreview = {
  document: BackupDocument;
  fileName: string;
  counts: Record<string, number>;
};

export async function pickBackupFile(): Promise<{ status: 'picked'; preview: ImportPreview } | { status: 'cancelled' } | { status: 'invalid'; reason: string }> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };
    const asset = result.assets[0];
    const file = new File(asset.uri);
    const text = await file.text();
    return validateBackupText(text, asset.name ?? 'backup');
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateBackupText(text: string, fileName: string): { status: 'picked'; preview: ImportPreview } | { status: 'invalid'; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'This file is not a readable backup.' };
  }
  const result = BackupDocumentSchema.safeParse(parsed);
  if (!result.success) {
    return { status: 'invalid', reason: `This file is not a ${BRAND.APP_NAME} backup, or it came from a newer version.` };
  }
  if (result.data.formatVersion > 1) {
    return { status: 'invalid', reason: 'This backup was created by a newer version of the app.' };
  }
  return {
    status: 'picked',
    preview: { document: result.data, fileName, counts: result.data.counts },
  };
}

export type ImportMode = 'merge' | 'replace';

export type ImportResult =
  | { status: 'imported'; mode: ImportMode; rows: number; safetyBackupPath?: string }
  | { status: 'failed'; reason: string };

async function insertRows(table: string, rows: Record<string, string | number | null>[], replace: boolean): Promise<number> {
  if (rows.length === 0) return 0;
  if (replace) {
    await execSql(`DELETE FROM ${table}`);
  }
  const { db } = await import('../db/database.ts');
  const handle = await db();
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${columns
      .map((column) => `"${column.replace(/[^a-z_]/gi, '')}"`)
      .join(',')}) VALUES (${placeholders})`;
    try {
      await handle.runAsync(sql, columns.map((column) => row[column]) as never);
      inserted += 1;
    } catch {
      // A row that does not fit the current schema is skipped rather than
      // aborting the whole import; the caller reports how many rows landed.
    }
  }
  return inserted;
}

export async function importBackup(preview: ImportPreview, mode: ImportMode): Promise<ImportResult> {
  let safetyBackupPath: string | undefined;
  try {
    if (mode === 'replace') {
      const safety = await exportBackup();
      if (safety.status === 'exported') safetyBackupPath = safety.path;
      await wipeAllData();
    }
    let rows = 0;
    for (const table of BACKUP_TABLES) {
      const tableRows = preview.document.tables[table];
      if (!tableRows) continue;
      rows += await insertRows(table, tableRows, false);
    }
    return { status: 'imported', mode, rows, safetyBackupPath };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Lists backup files the app has produced, for the settings screen. */
export async function listLocalBackups(): Promise<{ name: string; uri: string; sizeBytes: number }[]> {
  try {
    const directory = new Directory(Paths.document);
    const entries = directory.list();
    return entries
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(BACKUP_FILE_EXTENSION))
      .map((file) => ({ name: file.name, uri: file.uri, sizeBytes: file.size ?? 0 }));
  } catch {
    return [];
  }
}
