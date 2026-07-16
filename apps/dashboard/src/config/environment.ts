const DEFAULT_API_BASE_URL = "http://localhost:8080/api/v1/dashboard/"

function readApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_API_BASE_URL
}

export const dashboardEnvironment = Object.freeze({
  apiBaseUrl: readApiBaseUrl(),
})
