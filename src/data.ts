export type NavKey = "dashboard" | "radar" | "crm" | "campaigns" | "comments" | "reports" | "safety" | "settings";

export type ChannelRisk = "low" | "medium" | "high";
export type ChannelStatus = "watching" | "candidate" | "partner";
export type LeadStage = "new" | "qualified" | "proposal" | "won";
export type CampaignStatus = "draft" | "ready" | "active" | "paused";

export type Channel = {
  id: number;
  title: string;
  handle: string;
  topic: string;
  members: number;
  growth: number;
  engagement: number;
  avgViews: number;
  postsPerDay: number;
  source: string;
  risk: ChannelRisk;
  keywords: string[];
  lastSignal: string;
  status: ChannelStatus;
};

export type Lead = {
  id: number;
  name: string;
  source: string;
  stage: LeadStage;
  score: number;
  value: number;
  consent: boolean;
  lastTouch: string;
  owner: string;
  notes: string;
  tags: string[];
};

export type Campaign = {
  id: number;
  name: string;
  audience: string;
  status: CampaignStatus;
  goal: string;
  planned: string;
  consentRequired: boolean;
  tone: string;
  optInRate: number;
  risk: ChannelRisk;
  messages: string[];
};

export type Task = {
  id: number;
  title: string;
  due: string;
  owner: string;
  status: "queued" | "today" | "done";
  type: "research" | "crm" | "campaign" | "safety";
};

export type AiCommentRule = {
  id: number;
  channel: string;
  persona: string;
  tone: "expert" | "friendly" | "founder" | "supportive";
  goal: "value" | "question" | "partner" | "clarify";
  maxPerDay: number;
  manualApproval: boolean;
  avoidSalesPitch: boolean;
  signature: string;
  stopWords: string[];
  enabled: boolean;
};

export type ModelProvider = "codex" | "grok" | "gemini-cli" | "gemini";

export type XedocGatewayConfig = {
  baseUrl: string;
  token: string;
  agentId: string;
  repoId: string;
  kind: ModelProvider;
  model: string;
  waitMs: number;
};

export type EventPersona = {
  id: number;
  name: string;
  handle: string;
  role: string;
  topics: string;
  kind: ModelProvider;
  enabled: boolean;
};

export type EventDialogueTurn = {
  id: number;
  speaker: string;
  account: string;
  reply: string;
};

export const seedChannels: Channel[] = [
  {
    id: 1,
    title: "AI Product Lab",
    handle: "@aiproductlab",
    topic: "AI SaaS",
    members: 48200,
    growth: 14.8,
    engagement: 11.6,
    avgViews: 18800,
    postsPerDay: 4,
    source: "public",
    risk: "low",
    keywords: ["saas", "claude", "automation"],
    lastSignal: "8 демо-запросов за 7 дней",
    status: "partner"
  },
  {
    id: 2,
    title: "Founder Signals RU",
    handle: "@foundersignalsru",
    topic: "B2B лиды",
    members: 21300,
    growth: 8.4,
    engagement: 9.9,
    avgViews: 7200,
    postsPerDay: 3,
    source: "manual",
    risk: "low",
    keywords: ["telegram", "sales", "b2b"],
    lastSignal: "частые вопросы про Telegram CRM",
    status: "candidate"
  },
  {
    id: 3,
    title: "Маркетинг без шума",
    handle: "@quietgrowth",
    topic: "Маркетинг",
    members: 38500,
    growth: 5.2,
    engagement: 7.4,
    avgViews: 10500,
    postsPerDay: 2,
    source: "import",
    risk: "medium",
    keywords: ["воронка", "посевы", "ретеншн"],
    lastSignal: "дорогие посевы, высокий отклик",
    status: "watching"
  },
  {
    id: 4,
    title: "Security Founders",
    handle: "@secfounders",
    topic: "Кибербезопасность",
    members: 14900,
    growth: 11.1,
    engagement: 14.2,
    avgViews: 6100,
    postsPerDay: 2,
    source: "public",
    risk: "low",
    keywords: ["безопасность", "аудит", "telegram"],
    lastSignal: "запросы на безопасную автоматизацию",
    status: "candidate"
  }
];

export const seedLeads: Lead[] = [
  {
    id: 1,
    name: "Xedoc Labs",
    source: "@aiproductlab",
    stage: "proposal",
    score: 92,
    value: 2400,
    consent: true,
    lastTouch: "Сегодня",
    owner: "Rodion",
    notes: "Нужен аудит Telegram-воронки и отчет по каналам.",
    tags: ["saas", "warm"]
  },
  {
    id: 2,
    name: "LeadOps Studio",
    source: "@foundersignalsru",
    stage: "qualified",
    score: 81,
    value: 1500,
    consent: true,
    lastTouch: "Вчера",
    owner: "Rodion",
    notes: "Интерес к CRM и opt-in сегментам.",
    tags: ["crm", "demo"]
  },
  {
    id: 3,
    name: "Growth Craft",
    source: "веб-форма",
    stage: "new",
    score: 66,
    value: 700,
    consent: true,
    lastTouch: "2 дня назад",
    owner: "Rodion",
    notes: "Сравнивают посевы с партнерскими интеграциями.",
    tags: ["seed", "audit"]
  },
  {
    id: 4,
    name: "SecureBot Team",
    source: "@secfounders",
    stage: "won",
    score: 88,
    value: 3200,
    consent: true,
    lastTouch: "Неделя назад",
    owner: "Rodion",
    notes: "Пилот на 30 дней, нужен weekly report.",
    tags: ["security", "paid"]
  }
];

export const seedCampaigns: Campaign[] = [
  {
    id: 1,
    name: "AI SaaS demo sprint",
    audience: "Основатели AI SaaS",
    status: "ready",
    goal: "demo",
    planned: "06.06",
    consentRequired: true,
    tone: "коротко, экспертно",
    optInRate: 68,
    risk: "low",
    messages: [
      "Спасибо за интерес к TG Hunter. Собрал короткий срез по вашим Telegram-точкам роста.",
      "Могу показать 3 публичных канала, где спрос уже виден по постам и комментариям.",
      "Если актуально, забронирую 15 минут и принесу готовую карту сегментов."
    ]
  },
  {
    id: 2,
    name: "Partner map",
    audience: "Редакторы каналов",
    status: "draft",
    goal: "partner",
    planned: "09.06",
    consentRequired: true,
    tone: "деловое партнерство",
    optInRate: 41,
    risk: "medium",
    messages: [
      "Вижу пересечение аудиторий и аккуратный партнерский формат без холодной рассылки.",
      "Подготовил медиакит с прогнозом охвата и CPA.",
      "Готов обсудить условия и прозрачную маркировку."
    ]
  }
];

export const seedCommentRules: AiCommentRule[] = [
  {
    id: 1,
    channel: "@aiproductlab",
    persona: "Основатель B2B SaaS, который делится практикой Telegram-роста.",
    tone: "expert",
    goal: "value",
    maxPerDay: 3,
    manualApproval: true,
    avoidSalesPitch: true,
    signature: "TG Hunter",
    stopWords: ["купите", "срочно", "гарантия", "накрутка"],
    enabled: true
  },
  {
    id: 2,
    channel: "@foundersignalsru",
    persona: "Аккуратный growth-консультант, который задает полезные уточняющие вопросы.",
    tone: "friendly",
    goal: "question",
    maxPerDay: 2,
    manualApproval: true,
    avoidSalesPitch: true,
    signature: "Rodion",
    stopWords: ["спам", "массовая рассылка", "инвайт"],
    enabled: true
  }
];

export const seedEventPersonas: EventPersona[] = [
  {
    id: 1,
    name: "Event Host",
    handle: "@event_host",
    role: "Организатор события: задает тему, держит тон спокойным и полезным.",
    topics: "event intro, framing, useful questions",
    kind: "codex",
    enabled: true
  },
  {
    id: 2,
    name: "Product Guest",
    handle: "@product_guest",
    role: "Участник события: добавляет практический опыт, задает уточняющие вопросы.",
    topics: "product launch, customer feedback, metrics",
    kind: "gemini",
    enabled: true
  },
  {
    id: 3,
    name: "Skeptical Founder",
    handle: "@founder_view",
    role: "Основатель: мягко спорит, просит примеры и не пишет рекламно.",
    topics: "risks, objections, examples",
    kind: "grok",
    enabled: true
  }
];

export const seedTasks: Task[] = [
  { id: 1, title: "Проверить 12 новых публичных каналов", due: "10:30", owner: "Rodion", status: "today", type: "research" },
  { id: 2, title: "Обновить медиакит для партнеров", due: "13:00", owner: "Rodion", status: "queued", type: "campaign" },
  { id: 3, title: "Закрыть preflight по кампании AI SaaS", due: "15:00", owner: "Rodion", status: "today", type: "safety" },
  { id: 4, title: "Перевести LeadOps Studio в proposal", due: "17:30", owner: "Rodion", status: "queued", type: "crm" }
];

export const keywordWeights = [
  { word: "saas", weight: 22 },
  { word: "telegram", weight: 18 },
  { word: "лиды", weight: 16 },
  { word: "crm", weight: 14 },
  { word: "аудит", weight: 13 },
  { word: "посевы", weight: 9 },
  { word: "бот", weight: 8 }
];

export const safetyMap = [
  {
    unsafe: "Массовая рассылка по чужим ID",
    safe: "Opt-in кампании и ручные follow-up задачи",
    state: "blocked"
  },
  {
    unsafe: "Парсинг приватных участников",
    safe: "Публичные каналы, посты и добровольные лиды",
    state: "active"
  },
  {
    unsafe: "Автоинвайты и регистрация аккаунтов",
    safe: "Партнерские размещения и верифицированные боты",
    state: "blocked"
  },
  {
    unsafe: "Накрутка реакций и жалобы",
    safe: "Прозрачные отчеты, UTM и аудит качества",
    state: "active"
  }
];

export const reportRows = [
  { label: "Trial -> paid", value: "21.4%", delta: "+3.1%" },
  { label: "Средний чек", value: "$640", delta: "+$90" },
  { label: "Посевы с ROI+", value: "17", delta: "+5" },
  { label: "Ответы opt-in", value: "49%", delta: "+8%" }
];
