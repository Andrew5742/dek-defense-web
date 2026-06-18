export const getPublicAppUrl = () => {
  const host = window.location.hostname
  const isLocalOrLan = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  const raw = isLocalOrLan
    ? window.location.origin
    : import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin
  return raw.replace(/\/$/, '')
}

export const buildStudentTemporaryUrl = (studentToken: string) => {
  return `${getPublicAppUrl()}/s/${encodeURIComponent(studentToken)}`
}

export const formatStudentTemporaryPath = (studentToken: string) => {
  return `/s/${studentToken}`
}
