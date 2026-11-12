# Clario — Frontend

React 19 + TypeScript + Vite arayüzü. Genel proje dokümantasyonu için [kök README](../README.md).

```bash
npm install
cp .env.example .env   # opsiyonel; /api istekleri varsayılan olarak http://localhost:4000'e iletilir
npm run dev            # http://localhost:5180 + yerel ağ adresi (Clario'ya ayrılmış sabit port)
```

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Tip kontrolü + production derlemesi |
| `npm run lint` | oxlint |

## Yapı

```
src/
├── api/           # axios istemcisi + endpoint başına tipli fonksiyon (getRisks, askAssistant…)
├── types/         # Backend yanıt tipleri (Risk, Opportunity, Customer, DashboardSummary…)
├── hooks/useApi   # loading / error / data durumu, sayfa değişince istek iptali
├── components/    # StatCard, RiskCard, OpportunityCard, ChurnCard, Sidebar,
│                  # LoadingState, EmptyState, ErrorState, AsyncContent…
│                  # AssistantWidget + AssistantOrb: sağ altta süzülen asistan karakteri
├── pages/         # 6 sayfa: Dashboard, Sales, Inventory, Customers, Risks,
│                  # Recommendations (her biri ayrı route, lazy-load)
├── theme.ts       # Tema bağlamı + grafik paleti (koyu varsayılan, açık seçenek)
├── index.css      # CSS değişkenleriyle tasarım sistemi
└── utils/         # tr-TR sayı/para/tarih biçimleri, etiket ve renk eşlemeleri
```

**Renk dili:** Risk kırmızı, fırsat yeşil, müşteri kaybı turuncu, nötr KPI'lar mavi/gri.
Açık tema beyaz kullanmaz: koyu temayla aynı mavi-gri ailesinden yumuşak bir "sis mavisi" paletidir.
Tema seçimi tarayıcıda hatırlanır ve sayfa açılırken yanlış temanın bir anlığına görünmesi engellenir.
