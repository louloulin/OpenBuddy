/** OS-backed string encryption (Electron `safeStorage`), moved from services/settings (R2). */
export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
