export interface SmartCommandMigrationResult {
  settings: Record<string, unknown>;
  migrated: boolean;
}

export async function removeSmartCommandsWithBackup(
  settings: Record<string, unknown>,
  backup: (content: string) => Promise<void>,
): Promise<SmartCommandMigrationResult> {
  if (!Object.prototype.hasOwnProperty.call(settings, "smartCommands")) {
    return { settings, migrated: false };
  }
  await backup(JSON.stringify({ smartCommands: settings.smartCommands }, null, 2));
  const { smartCommands: _removed, ...nextSettings } = settings;
  return { settings: nextSettings, migrated: true };
}
