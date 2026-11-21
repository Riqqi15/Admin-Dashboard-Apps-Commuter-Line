export interface PiiCipher {
  encrypt(value: string, context: string): string;
  decrypt(value: string, context: string): string;
}
