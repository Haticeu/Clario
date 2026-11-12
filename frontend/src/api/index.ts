/**
 * Backend endpoint'leri. Her fonksiyon tek bir endpoint'e karşılık gelir ve
 * backend'in döndürdüğü veri tipini taşır. İptal için AbortSignal alır.

 */
import type {
  AuthStatus,
  AuthUser,
  GooglePending,
  Me,
  AppSettings,
  AssistantExamples,
  CurrencyInfo,
  NewsArticle,
  NewsFeed,
  OrderDetail,
  SearchResults,
  ReportSettings,
  ReceivablesReport,
  ReceivableSettings,
  CustomerLedger,
  Statement,
  Report,
  ReportOptions,
  SegmentAnalysis,
  AssistantResponse,
  ChurnRisk,
  CustomerAnalysis,
  DashboardSummary,
  HealthResponse,
  InventoryIntelligence,
  ListResponse,
  Margin,
  Opportunity,
  RecommendationsResponse,
  Risk,
  SalesAnalytics,
  Thresholds,
} from '../types'
import type {
  ImportAnalysis,
  ImportMapping,
  ImportMode,
  ImportReport,
  InventoryRecord,
  OrderItemRecord,
  OrderRecord,
  ResourceName,
  ResourceRecords,
} from '../types/data'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, API_BASE_URL, send } from './client'
export { API_BASE_URL, ApiError, isAbortError, onUnauthorized, setRequestCurrency, toApiError } from './client'

/** Gündem soruları haber kaynaklarını okur; birkaç saniye sürebilir */
const NEWS_TIMEOUT_MS = 45_000

/** GET /api/health */
export const getHealth = (signal?: AbortSignal) => apiGet<HealthResponse>('/health', signal)

/** GET /api/config/thresholds */
export const getThresholds = (signal?: AbortSignal) => apiGet<Thresholds>('/config/thresholds', signal)

/** GET /api/dashboard/summary */
export const getDashboardSummary = (signal?: AbortSignal) => apiGet<DashboardSummary>('/dashboard/summary', signal)

/** GET /api/sales/analytics */
export const getSalesAnalytics = (signal?: AbortSignal) => apiGet<SalesAnalytics>('/sales/analytics', signal)

/** GET /api/margins */
export const getMargins = (signal?: AbortSignal) => apiGet<ListResponse<Margin>>('/margins', signal)

/** GET /api/inventory/intelligence */
export const getInventoryIntelligence = (signal?: AbortSignal) =>
  apiGet<InventoryIntelligence>('/inventory/intelligence', signal)

/** GET /api/customers/analysis */
export const getCustomerAnalysis = (signal?: AbortSignal) => apiGet<CustomerAnalysis>('/customers/analysis', signal)

/** GET /api/customers/churn */
export const getChurnRisks = (signal?: AbortSignal) => apiGet<ListResponse<ChurnRisk>>('/customers/churn', signal)

/** GET /api/risks */
export const getRisks = (signal?: AbortSignal) => apiGet<ListResponse<Risk>>('/risks', signal)

/** GET /api/opportunities */
export const getOpportunities = (signal?: AbortSignal) => apiGet<ListResponse<Opportunity>>('/opportunities', signal)

/** GET /api/recommendations */
export const getRecommendations = (signal?: AbortSignal) => apiGet<RecommendationsResponse>('/recommendations', signal)

/** GET /api/assistant/examples */
export const getAssistantExamples = (signal?: AbortSignal) => apiGet<AssistantExamples>('/assistant/examples', signal)

/** POST /api/assistant/ask — gündem soruları haber kaynaklarını okuduğu için daha uzun zaman aşımı */
export const askAssistant = (question: string, signal?: AbortSignal) =>
  apiPost<AssistantResponse>('/assistant/ask', { question }, signal, NEWS_TIMEOUT_MS)

/** GET /api/reports/options — rapor filtrelerinin seçenekleri */
export const getReportOptions = (signal?: AbortSignal) => apiGet<ReportOptions>('/reports/options', signal)

/** GET /api/reports/summary — filtreler URL sorgu parametresi olarak (from, to, category, customerId…) */
export const getReport = (query: string, signal?: AbortSignal) => apiGet<Report>(`/reports/summary?${query}`, signal)

/** GET /api/segments — departman ve proje analizi */
export const getSegments = (signal?: AbortSignal) => apiGet<SegmentAnalysis>('/segments', signal)

/** GET /api/news — gündem: haberlerin işletmeye olası etkileri */
export const getNews = (signal?: AbortSignal) => apiGet<NewsFeed>('/news', signal)

/** GET /api/news/:id/article — haberin metni (Clario içinde okumak için) */
export const getNewsArticle = (id: string, signal?: AbortSignal) => apiGet<NewsArticle>(`/news/${encodeURIComponent(id)}/article`, signal)

/** GET /api/search — müşteri, işlem, ürün, kategori, bölge, departman/proje ve giderlerde arama */
export const search = (query: string, signal?: AbortSignal) => apiGet<SearchResults>(`/search?q=${encodeURIComponent(query)}`, signal)

/** GET /api/statements — ekstre / rapor (sorgu: kind=monthly&month= · kind=daily&date= · kind=range&from=&to=) */
export const getStatement = (query: string, signal?: AbortSignal) => apiGet<Statement>(`/statements?${query}`, signal)

/** Excel indirme yolu (downloadApiFile ile) */
export const statementExcelPath = (query: string) => `/statements/export.xlsx?${query}`

/** GET/PUT /api/statements/settings — rapor bildirimleri */
export const getReportSettings = (signal?: AbortSignal) => apiGet<ReportSettings>('/statements/settings', signal)
export const saveReportSettings = (settings: ReportSettings) => apiPut<ReportSettings>('/statements/settings', settings)

/** GET /api/receivables — cari hesap: alacaklar, yaşlandırma, borçlar, 30 günlük görünüm */
export const getReceivablesReport = (signal?: AbortSignal) => apiGet<ReceivablesReport>('/receivables', signal)
export const saveReceivableSettings = (settings: ReceivableSettings) => apiPut<ReceivableSettings>('/receivables/settings', settings)
/** GET /api/receivables/customers/:id — cari hesap ekstresi */
export const getCustomerLedger = (id: number, signal?: AbortSignal) => apiGet<CustomerLedger>(`/receivables/customers/${id}`, signal)
export const customerLedgerExcelPath = (id: number) => `/receivables/customers/${id}/ledger.xlsx`
/** PATCH /api/data/expenses/:id/paid — borç ödendi (null: ödenmedi) */
export const setExpensePaid = (id: number, paidDate: string | null) => apiPatch<void>(`/data/expenses/${id}/paid`, { paidDate })

/** GET /api/orders/:id — işlem ayrıntısı */
export const getOrderDetail = (id: number, signal?: AbortSignal) => apiGet<OrderDetail>(`/orders/${id}`, signal)

/** POST /api/news/seen — bildirimler okundu */
export const markNewsSeen = () => apiPost<void>('/news/seen', {})

// ── Para birimi ──────────────────────────────────────────────────────────────

/** GET /api/settings — verilerin girildiği (ana) para birimi ve desteklenen para birimleri */
export const getSettings = (signal?: AbortSignal) => apiGet<AppSettings>('/settings', signal)

/** PUT /api/settings */
export const saveBaseCurrency = (baseCurrency: string) => apiPut<{ baseCurrency: string }>('/settings', { baseCurrency })

/** GET /api/currency — gösterim para birimi ve kullanılan son kur */
export const getCurrencyInfo = (signal?: AbortSignal) => apiGet<CurrencyInfo>('/currency', signal)

// ── Veri yönetimi ────────────────────────────────────────────────────────────

/** GET /api/data/{resource} */
export const listResource = <R extends ResourceName>(resource: R, signal?: AbortSignal) =>
  apiGet<{ items: ResourceRecords[R][] }>(`/data/${resource}`, signal).then((r) => r.items)

/** POST /api/data/{resource} */
export const createResource = (resource: ResourceName, body: Record<string, unknown>) =>
  apiPost<{ id: number }>(`/data/${resource}`, body)

/** PUT /api/data/{resource}/:id */
export const updateResource = (resource: ResourceName, id: number, body: Record<string, unknown>) =>
  apiPut<void>(`/data/${resource}/${id}`, body)

/** DELETE /api/data/{resource}/:id */
export const deleteResource = (resource: ResourceName, id: number) => apiDelete(`/data/${resource}/${id}`)

/** GET /api/data/orders */
export const listOrders = (limit: number, offset = 0, signal?: AbortSignal) =>
  apiGet<{ total: number; items: OrderRecord[] }>(`/data/orders?limit=${limit}&offset=${offset}`, signal)

/** GET /api/data/orders/:id/items */
export const getOrderItems = (id: number) =>
  apiGet<{ items: OrderItemRecord[] }>(`/data/orders/${id}/items`).then((r) => r.items)

/** POST /api/data/orders */
export const createOrder = (body: Record<string, unknown>) => apiPost<{ id: number; orderNo: string }>('/data/orders', body)

/** PATCH /api/data/orders/:id — yalnızca gönderilen alanlar (durum, departman, proje) değişir */
export const updateOrder = (id: number, changes: Partial<Pick<OrderRecord, 'status' | 'department' | 'project'>>) =>
  apiPatch<void>(`/data/orders/${id}`, changes)

/** DELETE /api/data/orders/:id */
export const deleteOrder = (id: number) => apiDelete(`/data/orders/${id}`)

/** GET /api/data/inventory */
export const listInventory = (signal?: AbortSignal) =>
  apiGet<{ items: InventoryRecord[] }>('/data/inventory', signal).then((r) => r.items)

/** PUT /api/data/inventory */
export const saveInventory = (items: InventoryRecord[]) => apiPut<{ updated: number }>('/data/inventory', items)

// ── Excel ────────────────────────────────────────────────────────────────────

/** POST /api/import/analyze — dosyadaki sayfaları ve önerilen sütun eşleştirmesini döner */
export const analyzeImport = (file: File) => apiUpload<ImportAnalysis>('/import/analyze', file)

/** POST /api/import — dryRun: yalnızca kontrol et, kaydetme. mapping: onaylanan sütun eşleştirmesi */
export const uploadImport = (file: File, mode: ImportMode, dryRun: boolean, mapping?: ImportMapping, skipInvalid = false) =>
  apiUpload<ImportReport>(`/import?mode=${mode}&dryRun=${dryRun}${skipInvalid ? '&skipInvalid=true' : ''}`, file, [422], mapping ? { 'X-Clario-Mapping': encodeURIComponent(JSON.stringify(mapping)) } : {})
// ── Hesap ────────────────────────────────────────────────────────────────────

/** GET /api/auth/status — kayıt ekranı için (eski veriler taşınabilir mi, parola kuralı) */
export const getAuthStatus = (signal?: AbortSignal) => apiGet<AuthStatus>('/auth/status', signal)

/** POST /api/auth/register — yanıttaki kurtarma anahtarı yalnızca bu kez gösterilir */
export const register = (body: { email: string; password: string; name: string; country: string }) =>
  apiPost<AuthUser>('/auth/register', body, undefined, 60_000)

/** POST /api/auth/login */
export const login = (email: string, password: string) => apiPost<AuthUser>('/auth/login', { email, password }, undefined, 60_000)

/** POST /api/auth/recover — kurtarma anahtarıyla yeni parola */
export const recoverAccount = (email: string, recoveryKey: string, newPassword: string) =>
  apiPost<AuthUser>('/auth/recover', { email, recoveryKey, newPassword }, undefined, 60_000)

/** POST /api/auth/logout */
export const logout = () => apiPost<void>('/auth/logout', {})

/** POST /api/auth/password */
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiPost<void>('/auth/password', { currentPassword, newPassword }, undefined, 60_000)

/** POST /api/auth/recovery-key — eskisini geçersiz kılar */
export const createRecoveryKey = (password: string) =>
  apiPost<{ recoveryKey: string }>('/auth/recovery-key', { password }, undefined, 60_000)

/** POST /api/auth/reset-data — işletme verileri silinir; hesap ve ayarlar kalır */
export const resetData = (password: string) => apiPost<void>('/auth/reset-data', { password }, undefined, 60_000)

/** DELETE /api/auth/account — hesap ve tüm veri kalıcı olarak silinir */
export const deleteAccount = (password: string) => send<void>('delete', '/auth/account', { password })

/** "Google ile devam et": tarayıcı bu adrese yönlendirilir (Google'a gidip /api/auth/google/callback ile döner) */
export const GOOGLE_START_URL = `${API_BASE_URL}/auth/google/start`

/** GET /api/auth/google/pending — Google doğrulandıysa beklenen adım */
export const getGooglePending = (signal?: AbortSignal) =>
  apiGet<{ pending: GooglePending | null }>('/auth/google/pending', signal).then((r) => r.pending)

/** POST /api/auth/google/complete — veri parolasıyla Google girişini tamamlar */
export const completeGoogle = (password: string, profile: { name?: string; country?: string } = {}) =>
  apiPost<AuthUser>('/auth/google/complete', { password, ...profile }, undefined, 60_000)

/** POST /api/auth/google/cancel */
export const cancelGoogle = () => apiPost<void>('/auth/google/cancel', {})

/** POST /api/auth/google/unlink — hesap e-posta + parolayla kullanılmaya devam eder */
export const unlinkGoogle = () => apiPost<void>('/auth/google/unlink', {})

/** GET /api/me — profil ve kurulum durumu */
export const getMe = (signal?: AbortSignal) => apiGet<Me>('/me', signal)

/** PATCH /api/me */
export const updateMe = (changes: { onboardingCompleted?: boolean; name?: string; country?: string }) => apiPatch<void>('/me', changes)

