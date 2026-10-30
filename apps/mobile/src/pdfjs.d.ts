declare module 'pdfjs-dist/build/pdf.js' {
  export const GlobalWorkerOptions: { workerSrc: string }
  export function getDocument(options: unknown): { promise: Promise<any> }
  const _default: unknown
  export default _default
}
