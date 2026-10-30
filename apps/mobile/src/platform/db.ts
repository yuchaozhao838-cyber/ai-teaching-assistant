/** 手机版的本地存储：IndexedDB（比 localStorage 大得多，能存整本教材） */

const DB_NAME = 'aitutor-mobile'
const DB_VERSION = 6
const STORES = ['docs', 'artifacts', 'practice', 'study', 'focus', 'mistakes', 'calendar', 'rules', 'timetable', 'ideas', 'prep', 'kv'] as const
type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === 'kv' ? 'key' : 'id' })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'))
  })
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('本地存储读写失败'))
      })
  )
}

export const store = {
  all<T>(name: StoreName): Promise<T[]> {
    return tx<T[]>(name, 'readonly', (objectStore) => objectStore.getAll() as IDBRequest<T[]>)
  },
  get<T>(name: StoreName, id: string): Promise<T | undefined> {
    return tx<T | undefined>(name, 'readonly', (objectStore) => objectStore.get(id) as IDBRequest<T | undefined>)
  },
  put<T>(name: StoreName, value: T): Promise<IDBValidKey> {
    return tx<IDBValidKey>(name, 'readwrite', (objectStore) => objectStore.put(value))
  },
  remove(name: StoreName, id: string): Promise<undefined> {
    return tx<undefined>(name, 'readwrite', (objectStore) => objectStore.delete(id) as IDBRequest<undefined>)
  },
  clear(name: StoreName): Promise<undefined> {
    return tx<undefined>(name, 'readwrite', (objectStore) => objectStore.clear() as IDBRequest<undefined>)
  },
  async kvGet<T>(key: string, fallback: T): Promise<T> {
    const row = await this.get<{ key: string; value: T }>('kv', key)
    return row ? row.value : fallback
  },
  async kvSet<T>(key: string, value: T): Promise<void> {
    await this.put('kv', { key, value })
  }
}
