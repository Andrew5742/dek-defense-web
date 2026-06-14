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
    openZoom?: (zoomUrl?: string) => Promise<void>
    setKioskMode?: (enabled: boolean) => Promise<boolean>
    closePresentation?: (password: string) => Promise<boolean>
    on?: (channel: string, callback: (payload: unknown) => void) => void
  }
}
