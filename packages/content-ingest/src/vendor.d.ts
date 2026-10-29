declare module 'adm-zip' {
  export interface ZipEntry {
    entryName: string
    isDirectory: boolean
    getData(): Buffer
  }

  export default class AdmZip {
    constructor(filePath?: string)
    getEntries(): ZipEntry[]
    getEntry(name: string): ZipEntry | null
    readAsText(entry: string | ZipEntry): string
    extractAllTo(targetPath: string, overwrite?: boolean): void
  }
}

declare module 'pdfjs-dist/legacy/build/pdf.js' {
  const pdfjs: any
  export = pdfjs
}
