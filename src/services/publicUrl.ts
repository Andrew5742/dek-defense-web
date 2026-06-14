export const getPublicAppUrl = () => {
  const raw = import.meta.env.VITE_PUBLIC_APP_URL || 'https://dek-defence.web.app'
  return raw.replace(/\/$/, '')
}

export const buildStudentTemporaryUrl = (studentToken: string) => {
  return `${getPublicAppUrl()}/s/${encodeURIComponent(studentToken)}`
}

export const formatStudentTemporaryPath = (studentToken: string) => {
  return `/s/${studentToken}`
}
