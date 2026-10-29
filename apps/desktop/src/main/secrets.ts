import { safeStorage } from "electron";

/** Linux에 암호 저장소(gnome-libsecret, kwallet)가 없어 고정 키로만 암호화하게 되는지 */
export const isWeakStorage = () => process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text";

/**
 * Linux에 암호 저장소가 없으면 Electron은 고정 키로만 암호화할 수 있고, 그것도 명시적으로 허용해야 쓸 수 있다.
 * gh CLI가 hosts.yml에 평문으로 두는 것과 같은 수준이라 허용하되, 화면에서 약하게 보관한다고 알린다. 파일 권한은 0600
 */
function ensureCrypto(): void {
  if (isWeakStorage()) safeStorage.setUsePlainTextEncryption(true);
}

export function encryptSecret(text: string): string {
  ensureCrypto();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("이 컴퓨터에서는 비밀값을 암호화해 보관할 수 없습니다");
  return safeStorage.encryptString(text).toString("base64");
}

export function decryptSecret(b64: string): string {
  ensureCrypto();
  return safeStorage.decryptString(Buffer.from(b64, "base64"));
}
