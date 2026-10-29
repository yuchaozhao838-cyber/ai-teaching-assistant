import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { SecretStore } from '@tutor/resource-service'

interface StoredSecret {
  enc: boolean
  value: string
}

/**
 * 密钥存储：优先用 Electron safeStorage（Windows 上走 DPAPI，绑定当前用户），
 * 系统不支持加密时退化为本机 base64 存储并在界面上提示。
 */
export function createSecretStore(file: string): SecretStore {
  let cache: Record<string, StoredSecret> | null = null

  const load = (): Record<string, StoredSecret> => {
    if (cache) return cache
    try {
      cache = JSON.parse(readFileSync(file, 'utf8')) as Record<string, StoredSecret>
    } catch {
      cache = {}
    }
    return cache
  }

  const persist = () => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(cache ?? {}, null, 2), { mode: 0o600 })
  }

  return {
    get(id) {
      const record = load()[id]
      if (!record?.value) return null
      try {
        if (record.enc) {
          if (!safeStorage.isEncryptionAvailable()) return null
          return safeStorage.decryptString(Buffer.from(record.value, 'base64'))
        }
        return Buffer.from(record.value, 'base64').toString('utf8')
      } catch {
        return null
      }
    },
    set(id, value) {
      const map = load()
      if (safeStorage.isEncryptionAvailable()) {
        map[id] = { enc: true, value: safeStorage.encryptString(value).toString('base64') }
      } else {
        map[id] = { enc: false, value: Buffer.from(value, 'utf8').toString('base64') }
      }
      persist()
    },
    remove(id) {
      const map = load()
      delete map[id]
      persist()
    }
  }
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}
