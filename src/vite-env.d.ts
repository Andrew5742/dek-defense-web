/// <reference types="vite/client" />

interface Window {
  dekAgent?: {
    isDesktop?: boolean
    getStatus?: () => Promise<{
      stationId: string
      stationName: string
      uploadUrl: string
      lanUploadUrl?: string
      storageRoot: string
      addresses: Array<{ name: string; address: string }>
    }>
    openStorage?: () => Promise<void>
    getStorage?: () => Promise<string>
    changeStorage?: () => Promise<string | null>
    openZoom?: (zoomUrl?: string) => Promise<void>
    setKioskMode?: (enabled: boolean) => Promise<boolean>
    closePresentation?: (password: string) => Promise<boolean>
    deletePresentation?: (sessionId: string, studentId: string) => Promise<boolean>
    listDrives?: () => Promise<Array<{ path: string; name: string; description: string }>>
    readDir?: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>
    uploadLocalFiles?: (files: string[], studentId: string, sessionId: string) => Promise<Array<{ originalFileName: string; storedName: string; path: string; extension: string }>>
    on?: (channel: string, callback: (payload: unknown) => void) => void
  }
}
