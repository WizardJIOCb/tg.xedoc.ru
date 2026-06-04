import {
  Activity,
  BadgeCheck,
  BellRing,
  Bot,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  Flag,
  Gauge,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Link,
  Lock,
  Megaphone,
  MessageSquareText,
  Plus,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Send,
  Trash2,
  UsersRound,
  WandSparkles,
  X
} from "lucide-react";
import { type ComponentType, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  type AiCommentRule,
  type Campaign,
  type CampaignStatus,
  type Channel,
  type ChannelRisk,
  type EventDialogueTurn,
  type EventPersona,
  type Lead,
  type LeadStage,
  type ModelProvider,
  type NavKey,
  type XedocGatewayConfig,
  keywordWeights,
  reportRows,
  safetyMap,
  seedCampaigns,
  seedChannels,
  seedCommentRules,
  seedEventPersonas,
  seedLeads,
  seedTasks
} from "./data";
import {
  aiCommentRuleSchema,
  campaignSchema,
  commentPostSchema,
  eventDialogueSchema,
  eventPersonaSchema,
  keywordSchema,
  leadSchema,
  publicTelegramSourceSchema,
  xedocGatewayConfigSchema
} from "./schemas";

const navItems: Array<{ key: NavKey; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "dashboard", label: "Пульт", icon: LayoutDashboard },
  { key: "radar", label: "Радар", icon: Radar },
  { key: "crm", label: "CRM", icon: KanbanSquare },
  { key: "campaigns", label: "Кампании", icon: Megaphone },
  { key: "comments", label: "AI-комменты", icon: MessageSquareText },
  { key: "reports", label: "Отчеты", icon: ChartNoAxesCombined },
  { key: "safety", label: "Защита", icon: ShieldCheck },
  { key: "settings", label: "Настройки", icon: Settings }
];

const stageLabels: Record<LeadStage, string> = {
  new: "Новый",
  qualified: "Квалифицирован",
  proposal: "Оффер",
  won: "Оплачен"
};

const campaignLabels: Record<CampaignStatus, string> = {
  draft: "Черновик",
  ready: "Готова",
  active: "Активна",
  paused: "Пауза"
};

const riskLabels: Record<ChannelRisk, string> = {
  low: "низкий",
  medium: "средний",
  high: "высокий"
};

type EventPersonaFormState = {
  name: string;
  handle: string;
  role: string;
  topics: string;
  kind: ModelProvider;
  enabled: boolean;
};

type EventDialogueFormState = {
  channel: string;
  postUrl: string;
  topic: string;
  postText: string;
  turns: string;
  triggerMode: "manual" | "new_post" | "scheduled";
  intensity: "calm" | "balanced" | "active" | "heated";
  dynamics: "supportive" | "debate" | "qa" | "painstorm" | "mixed";
  replyTarget: "post" | "previous" | "mixed";
  mood: string;
  audiencePain: string;
  experimentGoal: string;
  manualApproval: boolean;
  noAutoPost: boolean;
  ownChannel: boolean;
};

type GatewayStatus = {
  state: "idle" | "loading" | "success" | "error";
  message: string;
};

const defaultGatewayConfig: XedocGatewayConfig = {
  baseUrl: "https://xedoc.ru",
  token: "",
  agentId: "",
  repoId: "",
  kind: "codex",
  model: "",
  waitMs: 45000
};

const defaultPersonaForm: EventPersonaFormState = {
  name: "Event Guest",
  handle: "@event_guest",
  role: "Участник события: пишет коротко, по делу, задает один уточняющий вопрос.",
  topics: "AI event, Telegram discussion, useful questions",
  kind: "codex",
  enabled: true
};

const defaultDialogueForm: EventDialogueFormState = {
  channel: "@aiproductlab",
  postUrl: "",
  topic: "Запуск продукта на Telegram-аудиторию",
  postText:
    "Пост канала о запуске AI SaaS: автор показывает первые продажи, просит аудиторию поделиться опытом запуска через Telegram-каналы и обсуждения под постами.",
  turns: "6",
  triggerMode: "manual",
  intensity: "balanced",
  dynamics: "mixed",
  replyTarget: "mixed",
  mood: "curious, useful, slightly playful",
  audiencePain: "people want practical launch examples, risks, metrics, and honest objections",
  experimentGoal: "see how different personas discuss the post without sales pressure",
  manualApproval: true,
  noAutoPost: true,
  ownChannel: true
};

const providerLabels: Record<ModelProvider, string> = {
  codex: "Codex",
  grok: "Grok",
  "gemini-cli": "Gemini CLI",
  gemini: "Gemini"
};

type GatewayChatResponse = {
  chatId: string;
  error?: string;
};

type GatewayRunResponse = {
  jobId: string;
  finalMessage?: string | null;
  job?: { status?: string; finalMessage?: string | null };
  error?: string;
};

type AuthUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  createdAt?: string;
};

type SavedComment = {
  id: number;
  channel: string;
  postText: string;
  text: string;
  status: "draft" | "sent";
  createdAt: string;
};

type ServerState = {
  user: AuthUser;
  channels: Channel[];
  commentRules: AiCommentRule[];
  eventPersonas: EventPersona[];
  comments: SavedComment[];
  users: AuthUser[];
  xedocConfigured: boolean;
  telegramPostingConfigured: boolean;
};

type DraftResult = {
  drafts: string[];
  error: string;
  loading?: boolean;
};

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return initialValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  const setPersistentValue = (nextValue: T | ((previous: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof nextValue === "function" ? (nextValue as (previous: T) => T)(previous) : nextValue;
      window.localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };

  return [value, setPersistentValue] as const;
}

function titleFromHandle(handle: string) {
  return handle
    .replace(/^@/, "")
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function getFieldErrors(error: unknown) {
  if (!(error instanceof Error) || !("flatten" in error)) return {};

  const flattened = (error as { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }).flatten();
  return Object.fromEntries(
    Object.entries(flattened.fieldErrors).map(([field, messages]) => [field, messages?.[0] ?? ""])
  ) as Record<string, string>;
}

function scoreLead(value: number, notes: string) {
  const intent = notes.toLowerCase();
  const intentScore = ["демо", "аудит", "crm", "пилот", "оплата"].reduce(
    (sum, word) => sum + (intent.includes(word) ? 7 : 0),
    0
  );
  return Math.min(96, 48 + Math.round(value / 90) + intentScore);
}

function campaignMessages(goal: string, audience: string) {
  if (goal === "partner") {
    return [
      `Вижу пересечение с сегментом "${audience}" и аккуратный партнерский формат без холодной рассылки.`,
      "Подготовил медиакит с прогнозом охвата, маркировкой и понятными KPI.",
      "Готов обсудить условия и прозрачный тест на одну интеграцию."
    ];
  }

  if (goal === "audit") {
    return [
      `Собрал первичный аудит для сегмента "${audience}" по публичным Telegram-сигналам.`,
      "В отчете видны каналы, темы, риски и точки роста без парсинга приватных участников.",
      "Могу показать короткий разбор и список следующих действий."
    ];
  }

  if (goal === "reactivation") {
    return [
      `Вернулся с обновлением по "${audience}" - есть новые публичные сигналы спроса.`,
      "Сегмент стал теплее, но кампанию оставляем только для базы с согласием.",
      "Готов отправить краткий weekly snapshot и варианты продолжения."
    ];
  }

  return [
    `Спасибо за интерес к TG Hunter. Собрал короткий срез по сегменту "${audience}".`,
    "Могу показать 3 публичных канала, где спрос уже виден по постам и комментариям.",
    "Если актуально, забронирую 15 минут и принесу готовую карту сегментов."
  ];
}

function normalizeChannel(value: string) {
  return value.startsWith("https://t.me/") ? `@${value.split("/").filter(Boolean).at(-1) ?? ""}` : value;
}

function describeCommentGoal(goal: AiCommentRule["goal"]) {
  const labels: Record<AiCommentRule["goal"], string> = {
    value: "добавить полезный опыт",
    question: "задать умный вопрос",
    partner: "нащупать партнерство",
    clarify: "уточнить детали"
  };
  return labels[goal];
}

function describeCommentTone(tone: AiCommentRule["tone"]) {
  const labels: Record<AiCommentRule["tone"], string> = {
    expert: "экспертно",
    friendly: "дружелюбно",
    founder: "от лица основателя",
    supportive: "поддерживающе"
  };
  return labels[tone];
}

function generateCommentDrafts(rule: AiCommentRule | undefined, postText: string) {
  if (!rule) return [];

  const cleanPost = postText.replace(/\s+/g, " ").trim();
  const topic = cleanPost.length > 118 ? `${cleanPost.slice(0, 118)}...` : cleanPost;
  const signature = rule.signature ? `\n\n- ${rule.signature}` : "";
  const baseContext = `${describeCommentTone(rule.tone)}, цель: ${describeCommentGoal(rule.goal)}`;

  const drafts = [
    `Хороший разбор. Я бы отдельно проверил, где именно аудитория уже показывает спрос: вопросы в комментариях, повторяющиеся темы постов и динамика просмотров. Это часто точнее, чем смотреть только на размер канала.${signature}`,
    `Вижу здесь важный сигнал: "${topic}". Если разложить это на воронку, первым шагом я бы собрал публичные каналы по нише, потом отделил теплые обсуждения от просто охватных публикаций.${signature}`,
    `Согласен с мыслью. Практичный тест: взять 3-5 похожих каналов, сравнить ER, частоту постов и темы, где люди задают вопросы. Так быстрее понять, где есть живой спрос, а где просто шум.${signature}`
  ];

  return drafts.map((draft) => `${draft}\n\nКонтроль: ${baseContext}; без автопостинга.`);
}

function gatewayUrl(config: XedocGatewayConfig, path: string) {
  return `${config.baseUrl.replace(/\/+$/, "")}${path}`;
}

async function gatewayRequest<T>(config: XedocGatewayConfig, path: string, body?: unknown): Promise<T> {
  const response = await fetch(gatewayUrl(config, path), {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

function modelBody(config: XedocGatewayConfig, kind: ModelProvider) {
  return {
    agentId: config.agentId.trim() || undefined,
    repoId: config.repoId.trim() || undefined,
    kind,
    model: kind === config.kind && config.model.trim() ? config.model.trim() : undefined,
    waitMs: config.waitMs
  };
}

function cleanModelReply(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function buildTurnPrompt(
  input: EventDialogueFormState,
  personas: EventPersona[],
  persona: EventPersona,
  transcript: EventDialogueTurn[],
  index: number
) {
  const previous = transcript.length
    ? transcript.map((turn) => `${turn.speaker} (${turn.account}): ${turn.reply}`).join("\n")
    : "Пока реплик нет.";

  return [
    "Сгенерируй одну реплику-комментарий для Telegram-обсуждения под постом.",
    "",
    "Правила безопасности:",
    "- Это черновик для ручного согласования, не автопостинг.",
    "- Не изображай независимого случайного пользователя и не создавай ощущение накрутки.",
    "- Аккаунты ниже являются согласованными event-персонами/ролями для собственного или согласованного канала.",
    "- Не пиши агрессивную рекламу, спам, призывы купить, обманные утверждения.",
    "- Верни только текст комментария без JSON, Markdown и пояснений.",
    "",
    `Канал: ${normalizeChannel(input.channel)}`,
    input.postUrl.trim() ? `Пост: ${input.postUrl.trim()}` : "",
    `Тема события: ${input.topic.trim()}`,
    `Текст поста: ${input.postText.trim()}`,
    "",
    "Event-персоны:",
    personas.map((item) => `- ${item.name} (${item.handle}, ${providerLabels[item.kind]}): ${item.role}`).join("\n"),
    "",
    `Сейчас ход ${index}. Автор реплики: ${persona.name} (${persona.handle}). Роль: ${persona.role}`,
    "",
    "Предыдущий диалог:",
    previous,
    "",
    "Нужна естественная реплика на русском: 1-3 предложения, до 450 символов, с привязкой к посту или предыдущей реплике."
  ].filter(Boolean).join("\n");
}

function App() {
  const [auth, setAuth] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: "rodion", password: "" });
  const [loginError, setLoginError] = useState("");
  const [serverInfo, setServerInfo] = useState({ xedocConfigured: false, telegramPostingConfigured: false });
  const [telegramForm, setTelegramForm] = useState({
    discussionChatId: "",
    replyToMessageId: "",
    confirmedOwnChannel: true
  });
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "user" });
  const [savedComments, setSavedComments] = useState<SavedComment[]>([]);
  const [serverDraftResult, setServerDraftResult] = useState<DraftResult>({ drafts: [], error: "" });
  const [active, setActive] = useState<NavKey>("dashboard");
  const [channels, setChannels] = usePersistentState<Channel[]>("tg-hunter.channels", seedChannels);
  const [leads, setLeads] = usePersistentState<Lead[]>("tg-hunter.leads", seedLeads);
  const [campaigns, setCampaigns] = usePersistentState<Campaign[]>("tg-hunter.campaigns", seedCampaigns);
  const [commentRules, setCommentRules] = usePersistentState<AiCommentRule[]>(
    "tg-hunter.commentRules",
    seedCommentRules
  );
  const [gatewayConfig, setGatewayConfig] = usePersistentState<XedocGatewayConfig>(
    "tg-hunter.xedocGateway",
    defaultGatewayConfig
  );
  const [eventPersonas, setEventPersonas] = usePersistentState<EventPersona[]>(
    "tg-hunter.eventPersonas",
    seedEventPersonas
  );
  const [eventDialogue, setEventDialogue] = usePersistentState<EventDialogueTurn[]>(
    "tg-hunter.eventDialogue",
    []
  );
  const [sourceForm, setSourceForm] = useState({ source: "@", topic: "", note: "" });
  const [leadForm, setLeadForm] = useState({ name: "", source: "", value: "900", consent: true, notes: "" });
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    audience: "",
    goal: "demo",
    consentOnly: true
  });
  const [commentRuleForm, setCommentRuleForm] = useState({
    channel: "@aiproductlab",
    persona: "Эксперт по Telegram-росту, который пишет полезные комментарии без продажного давления.",
    tone: "expert",
    goal: "value",
    maxPerDay: "3",
    manualApproval: true,
    avoidSalesPitch: true,
    signature: "TG Hunter",
    stopWords: "купите, срочно, гарантия, накрутка"
  });
  const [personaForm, setPersonaForm] = useState<EventPersonaFormState>(defaultPersonaForm);
  const [dialogueForm, setDialogueForm] = usePersistentState<EventDialogueFormState>(
    "tg-hunter.dialogueForm",
    defaultDialogueForm
  );
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>({ state: "idle", message: "" });
  const [selectedRuleId, setSelectedRuleId] = useState(seedCommentRules[0]?.id ?? 0);
  const [commentPostText, setCommentPostText] = useState(
    "Пост про запуск AI SaaS: автор показывает рост выручки, Telegram-канал как комьюнити и первые продажи через публичные обсуждения."
  );
  const [keywordText, setKeywordText] = useState("Telegram CRM для AI SaaS: лиды, аудит каналов, партнерские посевы и воронка демо.");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");

  const totals = useMemo(() => {
    const pipeline = leads.reduce((sum, lead) => sum + lead.value, 0);
    const mrr = leads.filter((lead) => lead.stage === "won").reduce((sum, lead) => sum + lead.value, 0);
    const optInLeads = leads.filter((lead) => lead.consent).length;
    const publicSignals = channels.reduce((sum, channel) => sum + Math.round(channel.members * (channel.engagement / 100)), 0);
    const riskScore = campaigns.reduce((sum, campaign) => sum + (campaign.risk === "low" ? 48 : 31), 0) + 8;

    return {
      pipeline,
      mrr,
      optInLeads,
      publicSignals,
      riskScore: Math.min(100, riskScore)
    };
  }, [campaigns, channels, leads]);

  const keywordResult = useMemo(() => {
    const parsed = keywordSchema.safeParse({ text: keywordText });
    if (!parsed.success) {
      return { score: 0, hits: [], error: parsed.error.flatten().fieldErrors.text?.[0] ?? "" };
    }

    const lower = parsed.data.text.toLowerCase();
    const hits = keywordWeights.filter((item) => lower.includes(item.word));
    const score = Math.min(100, hits.reduce((sum, item) => sum + item.weight, 18));
    return { score, hits, error: "" };
  }, [keywordText]);

  const selectedCommentRule = useMemo(
    () => commentRules.find((rule) => rule.id === selectedRuleId) ?? commentRules[0],
    [commentRules, selectedRuleId]
  );

  const commentDraftResult = useMemo(() => {
    const parsed = commentPostSchema.safeParse({ text: commentPostText });
    if (!parsed.success) {
      return { drafts: [], error: parsed.error.flatten().fieldErrors.text?.[0] ?? "" };
    }

    return { drafts: generateCommentDrafts(selectedCommentRule, parsed.data.text), error: "" };
  }, [commentPostText, selectedCommentRule]);

  const visibleCommentDraftResult = serverDraftResult.drafts.length || serverDraftResult.loading || serverDraftResult.error
    ? serverDraftResult
    : commentDraftResult;

  const applyServerState = (state: ServerState) => {
    setAuth(state.user);
    setChannels(state.channels);
    setCommentRules(state.commentRules);
    setEventPersonas(state.eventPersonas);
    setSavedComments(state.comments);
    setUsers(state.users);
    setServerInfo({
      xedocConfigured: state.xedocConfigured,
      telegramPostingConfigured: state.telegramPostingConfigured
    });
  };

  useEffect(() => {
    let alive = true;
    apiRequest<ServerState>("/api/state")
      .then((state) => {
        if (!alive) return;
        applyServerState(state);
      })
      .catch(() => {
        if (alive) setAuth(null);
      })
      .finally(() => {
        if (alive) setAuthLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setGatewayConfig((previous) => previous.token ? { ...previous, token: "" } : previous);
  }, []);

  useEffect(() => {
    setDialogueForm((previous) => ({ ...defaultDialogueForm, ...previous }));
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    try {
      const response = await apiRequest<{ user: AuthUser; state: ServerState }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      applyServerState(response.state);
      showToast(`Вошли как ${response.user.username}`);
    } catch {
      setLoginError("Неверный логин или пароль");
    }
  };

  const logout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuth(null);
    showToast("Сессия завершена");
  };

  const addChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = publicTelegramSourceSchema.safeParse(sourceForm);
    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    try {
      const response = await apiRequest<{ channels: Channel[] }>("/api/channels", {
        method: "POST",
        body: JSON.stringify(parsed.data)
      });
      setChannels(response.channels);
      setSourceForm({ source: "@", topic: "", note: "" });
      setErrors({});
      showToast("Источник добавлен в радар");
    } catch (error) {
      setErrors({
        source: error instanceof Error && error.message === "channel_exists" ? "Канал уже добавлен" : "Не удалось добавить канал"
      });
    }
  };

  const addLead = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = leadSchema.safeParse({
      ...leadForm,
      value: Number(leadForm.value)
    });

    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    const nextLead: Lead = {
      id: Date.now(),
      name: parsed.data.name,
      source: parsed.data.source,
      stage: "new",
      score: scoreLead(parsed.data.value, parsed.data.notes ?? ""),
      value: parsed.data.value,
      consent: parsed.data.consent,
      lastTouch: "Сейчас",
      owner: "Rodion",
      notes: parsed.data.notes || "Добавлен вручную",
      tags: ["manual", "opt-in"]
    };

    setLeads((previous) => [nextLead, ...previous]);
    setLeadForm({ name: "", source: "", value: "900", consent: true, notes: "" });
    setErrors({});
    showToast("Лид добавлен в CRM");
  };

  const addCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = campaignSchema.safeParse(campaignForm);
    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    const nextCampaign: Campaign = {
      id: Date.now(),
      name: parsed.data.name,
      audience: parsed.data.audience,
      status: "draft",
      goal: parsed.data.goal,
      planned: "черновик",
      consentRequired: parsed.data.consentOnly,
      tone: "экспертно, без давления",
      optInRate: 52,
      risk: "low",
      messages: campaignMessages(parsed.data.goal, parsed.data.audience)
    };

    setCampaigns((previous) => [nextCampaign, ...previous]);
    setCampaignForm({ name: "", audience: "", goal: "demo", consentOnly: true });
    setErrors({});
    showToast("Кампания создана");
  };

  const addCommentRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = aiCommentRuleSchema.safeParse(commentRuleForm);
    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    const nextRule: AiCommentRule = {
      id: Date.now(),
      channel: normalizeChannel(parsed.data.channel),
      persona: parsed.data.persona,
      tone: parsed.data.tone,
      goal: parsed.data.goal,
      maxPerDay: parsed.data.maxPerDay,
      manualApproval: parsed.data.manualApproval,
      avoidSalesPitch: parsed.data.avoidSalesPitch,
      signature: parsed.data.signature,
      stopWords: (parsed.data.stopWords ?? "")
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean),
      enabled: true
    };

    setCommentRules((previous) => [nextRule, ...previous]);
    setSelectedRuleId(nextRule.id);
    setErrors({});
    showToast("Правило AI-комментариев добавлено");
  };

  const copyCommentDraft = async (draft: string) => {
    await navigator.clipboard.writeText(draft);
    showToast("Черновик скопирован");
  };

  const sendTelegramComment = async (draft: string) => {
    if (!serverInfo.telegramPostingConfigured) {
      showToast("Telegram Bot API не настроен на сервере");
      return;
    }
    if (!telegramForm.discussionChatId.trim() || !telegramForm.confirmedOwnChannel) {
      showToast("Укажите discussion chat и подтвердите канал");
      return;
    }
    await apiRequest("/api/telegram/send-comment", {
      method: "POST",
      body: JSON.stringify({
        text: draft,
        discussionChatId: telegramForm.discussionChatId.trim(),
        replyToMessageId: telegramForm.replyToMessageId.trim() ? Number(telegramForm.replyToMessageId) : undefined,
        confirmedOwnChannel: telegramForm.confirmedOwnChannel
      })
    });
    showToast("Комментарий отправлен ботом");
  };

  const generateAiComments = async () => {
    const parsed = commentPostSchema.safeParse({ text: commentPostText });
    if (!parsed.success) {
      setServerDraftResult({ drafts: [], error: parsed.error.flatten().fieldErrors.text?.[0] ?? "" });
      return;
    }
    setServerDraftResult({ drafts: [], error: "", loading: true });
    try {
      const response = await apiRequest<{ drafts: string[]; comments: SavedComment[] }>("/api/comments/generate", {
        method: "POST",
        body: JSON.stringify({
          channel: selectedCommentRule?.channel ?? "@aiproductlab",
          postText: parsed.data.text,
          persona: selectedCommentRule?.persona,
          tone: selectedCommentRule?.tone,
          goal: selectedCommentRule?.goal,
          provider: gatewayConfig.kind,
          count: 3
        })
      });
      setServerDraftResult({ drafts: response.drafts, error: "" });
      setSavedComments((previous) => [...response.comments, ...previous]);
      showToast("AI-комментарии готовы");
    } catch {
      setServerDraftResult({ drafts: [], error: "Не удалось вызвать AI. Локальные черновики ниже остаются доступны." });
    }
  };

  const addPersona = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = eventPersonaSchema.safeParse(personaForm);
    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    try {
      const response = await apiRequest<{ eventPersonas: EventPersona[] }>("/api/event-personas", {
        method: "POST",
        body: JSON.stringify(parsed.data)
      });
      setEventPersonas(response.eventPersonas);
      setPersonaForm(defaultPersonaForm);
      setErrors({});
    showToast("Event-аккаунт добавлен");
    } catch (error) {
      setErrors({ handle: error instanceof Error && error.message === "event_persona_exists" ? "Event-аккаунт уже есть" : "Не удалось сохранить event-аккаунт" });
    }
  };

  const removePersona = async (personaId: number) => {
    const response = await apiRequest<{ eventPersonas: EventPersona[] }>(`/api/event-personas/${personaId}`, {
      method: "DELETE"
    });
    setEventPersonas(response.eventPersonas);
    showToast("Event-аккаунт удален");
  };

  const togglePersona = async (persona: EventPersona) => {
    const response = await apiRequest<{ eventPersonas: EventPersona[] }>(`/api/event-personas/${persona.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !persona.enabled })
    });
    setEventPersonas(response.eventPersonas);
    showToast(!persona.enabled ? "Event-аккаунт включен" : "Event-аккаунт выключен");
  };

  const generateEventDialogue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedDialogue = eventDialogueSchema.safeParse(dialogueForm);
    if (!parsedDialogue.success) {
      setErrors(getFieldErrors(parsedDialogue.error));
      setGatewayStatus({ state: "error", message: "Проверьте настройки диалога события" });
      return;
    }

    const activePersonas = eventPersonas.filter((persona) => persona.enabled !== false);
    if (activePersonas.length < 2) {
      setGatewayStatus({ state: "error", message: "Для диалога нужны минимум два event-аккаунта" });
      return;
    }

    const personas = activePersonas.slice(0, 8);
    setErrors({});
    setEventDialogue([]);
    setGatewayStatus({ state: "loading", message: "Генерирую диалог через серверный xedoc.ru gateway" });

    try {
      const response = await apiRequest<{ turns: EventDialogueTurn[] }>("/api/event-dialogues/generate", {
        method: "POST",
        body: JSON.stringify({
          ...parsedDialogue.data,
          personas
        })
      });
      setEventDialogue(response.turns);
      setGatewayStatus({ state: "success", message: `Диалог создан: ${response.turns.length} реплик` });
      showToast("Диалог события создан");
    } catch (error) {
      setGatewayStatus({
        state: "error",
        message: `xedoc.ru: ${error instanceof Error ? error.message : "не удалось создать диалог"}`
      });
    }
  };

  const copyEventDialogue = async () => {
    if (!eventDialogue.length) return;
    await navigator.clipboard.writeText(
      eventDialogue.map((turn) => `${turn.speaker} (${turn.account}): ${turn.reply}`).join("\n\n")
    );
    showToast("Диалог скопирован");
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userForm.username.trim() || userForm.password.length < 8) {
      setErrors({ username: "Укажите логин", password: "Минимум 8 символов" });
      return;
    }
    try {
      const response = await apiRequest<{ users: AuthUser[] }>("/api/users", {
        method: "POST",
        body: JSON.stringify(userForm)
      });
      setUsers(response.users);
      setUserForm({ username: "", password: "", role: "user" });
      setErrors({});
      showToast("Пользователь создан");
    } catch (error) {
      setErrors({ username: error instanceof Error && error.message === "user_exists" ? "Такой пользователь уже есть" : "Не удалось создать пользователя" });
    }
  };

  const exportPlan = () => {
    const payload = {
      product: "TG Hunter",
      domain: "tg.xedoc.ru",
      generatedAt: new Date().toISOString(),
      policy: "public sources and opt-in contacts only",
      channels,
      leads,
      campaigns,
      commentRules,
      eventPersonas,
      eventDialogue,
      xedocGateway: {
        ...gatewayConfig,
        token: gatewayConfig.token ? "configured" : ""
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tg-hunter-plan.json";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("План экспортирован");
  };

  if (authLoading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Radar size={26} />
          <h1>TG Hunter</h1>
          <p>Загружаю рабочее пространство...</p>
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <LoginView
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        login={login}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="TG Hunter">
        <div className="brand">
          <span className="brand-mark">
            <Radar size={22} />
          </span>
          <div>
            <strong>TG Hunter</strong>
            <small>tg.xedoc.ru</small>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={active === item.key ? "nav-item active" : "nav-item"}
                onClick={() => setActive(item.key)}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <ShieldCheck size={18} />
          <span>Только публичные источники и согласованная база.</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Telegram growth OS</p>
            <h1>{navItems.find((item) => item.key === active)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <span className="user-pill">{auth.username} · {auth.role}</span>
            <button type="button" className="icon-button" title="Экспорт" onClick={exportPlan}>
              <Download size={18} />
            </button>
            <button type="button" className="button secondary" onClick={logout}>
              <Lock size={17} />
              Выйти
            </button>
            <a className="button secondary" href="https://t.me" target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              Telegram
            </a>
          </div>
        </header>

        {active === "dashboard" && (
          <Dashboard
            channels={channels}
            leads={leads}
            campaigns={campaigns}
            totals={totals}
            onNavigate={setActive}
          />
        )}

        {active === "radar" && (
          <RadarView
            channels={channels}
            sourceForm={sourceForm}
            setSourceForm={setSourceForm}
            addChannel={addChannel}
            errors={errors}
            keywordText={keywordText}
            setKeywordText={setKeywordText}
            keywordResult={keywordResult}
          />
        )}

        {active === "crm" && (
          <CrmView
            leads={leads}
            leadForm={leadForm}
            setLeadForm={setLeadForm}
            addLead={addLead}
            errors={errors}
            setLeads={setLeads}
          />
        )}

        {active === "campaigns" && (
          <CampaignsView
            campaigns={campaigns}
            campaignForm={campaignForm}
            setCampaignForm={setCampaignForm}
            addCampaign={addCampaign}
            errors={errors}
          />
        )}

        {active === "comments" && (
          <CommentsView
            rules={commentRules}
            selectedRuleId={selectedRuleId}
            setSelectedRuleId={setSelectedRuleId}
            ruleForm={commentRuleForm}
            setRuleForm={setCommentRuleForm}
            addRule={addCommentRule}
            errors={errors}
            postText={commentPostText}
            setPostText={setCommentPostText}
            draftResult={visibleCommentDraftResult}
            copyDraft={copyCommentDraft}
            sendTelegramComment={sendTelegramComment}
            generateAiComments={generateAiComments}
            telegramForm={telegramForm}
            setTelegramForm={setTelegramForm}
            gatewayConfig={gatewayConfig}
            setGatewayConfig={setGatewayConfig}
            eventPersonas={eventPersonas}
            personaForm={personaForm}
            setPersonaForm={setPersonaForm}
            addPersona={addPersona}
            removePersona={removePersona}
            togglePersona={togglePersona}
            dialogueForm={dialogueForm}
            setDialogueForm={setDialogueForm}
            generateEventDialogue={generateEventDialogue}
            eventDialogue={eventDialogue}
            gatewayStatus={gatewayStatus}
            copyEventDialogue={copyEventDialogue}
            serverInfo={serverInfo}
          />
        )}

        {active === "reports" && <ReportsView channels={channels} leads={leads} totals={totals} />}

        {active === "safety" && <SafetyView />}

        {active === "settings" && (
          <SettingsView
            exportPlan={exportPlan}
            auth={auth}
            users={users}
            userForm={userForm}
            setUserForm={setUserForm}
            createUser={createUser}
            serverInfo={serverInfo}
          />
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function LoginView({
  loginForm,
  setLoginForm,
  loginError,
  login
}: {
  loginForm: { username: string; password: string };
  setLoginForm: (value: { username: string; password: string }) => void;
  loginError: string;
  login: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={login}>
        <span className="brand-mark">
          <Radar size={24} />
        </span>
        <div>
          <p className="eyebrow">TG Hunter Admin</p>
          <h1>Вход</h1>
          <p>Доступ к каналам, AI-комментариям и event-диалогам.</p>
        </div>
        <Field label="Логин">
          <input
            autoComplete="username"
            value={loginForm.username}
            onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
          />
        </Field>
        <Field label="Пароль" error={loginError}>
          <input
            type="password"
            autoComplete="current-password"
            value={loginForm.password}
            onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
          />
        </Field>
        <button type="submit" className="button">
          <Lock size={17} />
          Войти
        </button>
      </form>
    </div>
  );
}

function Dashboard({
  channels,
  leads,
  campaigns,
  totals,
  onNavigate
}: {
  channels: Channel[];
  leads: Lead[];
  campaigns: Campaign[];
  totals: { pipeline: number; mrr: number; optInLeads: number; publicSignals: number; riskScore: number };
  onNavigate: (key: NavKey) => void;
}) {
  const stats = [
    { label: "MRR", value: `$${formatNumber(totals.mrr)}`, delta: "+18%", icon: CircleDollarSign, tone: "green" },
    { label: "Pipeline", value: `$${formatNumber(totals.pipeline)}`, delta: `${leads.length} лидов`, icon: UsersRound, tone: "teal" },
    { label: "Публичные сигналы", value: formatNumber(totals.publicSignals), delta: `${channels.length} каналов`, icon: Activity, tone: "amber" },
    { label: "Compliance", value: `${totals.riskScore}/100`, delta: "opt-in first", icon: Gauge, tone: "rose" }
  ];

  return (
    <div className="view-stack">
      <section className="command-strip">
        <div className="command-copy">
          <p className="eyebrow">SaaS cockpit</p>
          <h2>TG Hunter превращает публичные Telegram-сигналы в аккуратную B2B-воронку.</h2>
        </div>
        <div className="command-actions">
          <button type="button" className="button" onClick={() => onNavigate("radar")}>
            <Search size={17} />
            Найти каналы
          </button>
          <button type="button" className="button secondary" onClick={() => onNavigate("campaigns")}>
            <WandSparkles size={17} />
            Собрать кампанию
          </button>
        </div>
      </section>

      <section className="stats-grid" aria-label="Ключевые метрики">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className={`stat-card ${stat.tone}`} key={stat.label}>
              <Icon size={20} />
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.delta}</small>
            </article>
          );
        })}
      </section>

      <section className="dashboard-grid">
        <div className="section wide">
          <SectionHeader icon={Radar} title="Публичный радар" action="Смотреть" onAction={() => onNavigate("radar")} />
          <div className="radar-map" aria-label="Карта каналов">
            <div className="radar-ring ring-one" />
            <div className="radar-ring ring-two" />
            <div className="radar-ring ring-three" />
            {channels.slice(0, 4).map((channel, index) => (
              <div className={`radar-node node-${index + 1}`} key={channel.id}>
                <span>{channel.handle}</span>
                <strong>{channel.engagement}% ER</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <SectionHeader icon={BellRing} title="Сигналы" />
          <div className="timeline">
            {channels.slice(0, 4).map((channel) => (
              <div className="timeline-row" key={channel.id}>
                <span className="status-dot" />
                <div>
                  <strong>{channel.title}</strong>
                  <small>{channel.lastSignal}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <SectionHeader icon={Inbox} title="Задачи" />
          <div className="task-list">
            {seedTasks.map((task) => (
              <div className="task-row" key={task.id}>
                <span>{task.due}</span>
                <strong>{task.title}</strong>
                <small>{task.owner}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <SectionHeader icon={Megaphone} title="Кампании" action="Открыть" onAction={() => onNavigate("campaigns")} />
          <div className="metric-list">
            {campaigns.map((campaign) => (
              <MetricRow
                key={campaign.id}
                label={campaign.name}
                value={`${campaign.optInRate}%`}
                hint={campaignLabels[campaign.status]}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function RadarView({
  channels,
  sourceForm,
  setSourceForm,
  addChannel,
  errors,
  keywordText,
  setKeywordText,
  keywordResult
}: {
  channels: Channel[];
  sourceForm: { source: string; topic: string; note: string };
  setSourceForm: (value: { source: string; topic: string; note: string }) => void;
  addChannel: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
  keywordText: string;
  setKeywordText: (value: string) => void;
  keywordResult: { score: number; hits: Array<{ word: string; weight: number }>; error: string };
}) {
  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={FileSearch} title="Публичные каналы" />
        <div className="table channels-table">
          <div className="table-head">
            <span>Канал</span>
            <span>Ниша</span>
            <span>Рост</span>
            <span>ER</span>
            <span>Риск</span>
          </div>
          {channels.map((channel) => (
            <div className="table-row" key={channel.id}>
              <div>
                <strong>{channel.title}</strong>
                <small>{channel.handle}</small>
              </div>
              <span>{channel.topic}</span>
              <span>+{channel.growth}%</span>
              <span>{channel.engagement}%</span>
              <span className={`risk ${channel.risk}`}>{riskLabels[channel.risk]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={Plus} title="Добавить источник" />
        <form className="form" onSubmit={addChannel}>
          <Field label="Публичный канал" error={errors.source}>
            <input
              value={sourceForm.source}
              onChange={(event) => setSourceForm({ ...sourceForm, source: event.target.value })}
              placeholder="@channel"
            />
          </Field>
          <Field label="Ниша" error={errors.topic}>
            <input
              value={sourceForm.topic}
              onChange={(event) => setSourceForm({ ...sourceForm, topic: event.target.value })}
              placeholder="AI SaaS"
            />
          </Field>
          <Field label="Сигнал" error={errors.note}>
            <textarea
              value={sourceForm.note}
              onChange={(event) => setSourceForm({ ...sourceForm, note: event.target.value })}
              placeholder="Что заметили в публичном канале"
            />
          </Field>
          <button type="submit" className="button">
            <Plus size={17} />
            Добавить
          </button>
        </form>
      </section>

      <section className="section wide">
        <SectionHeader icon={Sparkles} title="AI-сигналы постов" />
        <div className="keyword-layout">
          <textarea
            className="keyword-input"
            value={keywordText}
            onChange={(event) => setKeywordText(event.target.value)}
          />
          <div className="keyword-score">
            <Gauge size={22} />
            <strong>{keywordResult.score}</strong>
            <span>market intent</span>
            {keywordResult.error && <small className="error-text">{keywordResult.error}</small>}
            <div className="chip-row">
              {keywordResult.hits.map((hit) => (
                <span className="chip" key={hit.word}>
                  {hit.word} +{hit.weight}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CrmView({
  leads,
  leadForm,
  setLeadForm,
  addLead,
  errors,
  setLeads
}: {
  leads: Lead[];
  leadForm: { name: string; source: string; value: string; consent: boolean; notes: string };
  setLeadForm: (value: { name: string; source: string; value: string; consent: boolean; notes: string }) => void;
  addLead: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
  setLeads: (value: Lead[] | ((previous: Lead[]) => Lead[])) => void;
}) {
  const stages: LeadStage[] = ["new", "qualified", "proposal", "won"];

  const advanceLead = (lead: Lead) => {
    const currentIndex = stages.indexOf(lead.stage);
    const nextStage = stages[Math.min(stages.length - 1, currentIndex + 1)];
    setLeads((previous) => previous.map((item) => (item.id === lead.id ? { ...item, stage: nextStage } : item)));
  };

  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={KanbanSquare} title="Воронка" />
        <div className="kanban">
          {stages.map((stage) => (
            <div className="kanban-column" key={stage}>
              <div className="column-head">
                <strong>{stageLabels[stage]}</strong>
                <span>{leads.filter((lead) => lead.stage === stage).length}</span>
              </div>
              {leads
                .filter((lead) => lead.stage === stage)
                .map((lead) => (
                  <div className="lead-row" key={lead.id}>
                    <div>
                      <strong>{lead.name}</strong>
                      <small>{lead.source}</small>
                    </div>
                    <div className="lead-meta">
                      <span>${formatNumber(lead.value)}</span>
                      <span>{lead.score}</span>
                    </div>
                    <button type="button" className="mini-button" onClick={() => advanceLead(lead)} title="Следующий этап">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={Plus} title="Новый opt-in лид" />
        <form className="form" onSubmit={addLead}>
          <Field label="Компания" error={errors.name}>
            <input value={leadForm.name} onChange={(event) => setLeadForm({ ...leadForm, name: event.target.value })} />
          </Field>
          <Field label="Источник" error={errors.source}>
            <input
              value={leadForm.source}
              onChange={(event) => setLeadForm({ ...leadForm, source: event.target.value })}
              placeholder="@channel или форма"
            />
          </Field>
          <Field label="Бюджет" error={errors.value}>
            <input
              type="number"
              min="0"
              value={leadForm.value}
              onChange={(event) => setLeadForm({ ...leadForm, value: event.target.value })}
            />
          </Field>
          <Field label="Заметка" error={errors.notes}>
            <textarea value={leadForm.notes} onChange={(event) => setLeadForm({ ...leadForm, notes: event.target.value })} />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={leadForm.consent}
              onChange={(event) => setLeadForm({ ...leadForm, consent: event.target.checked })}
            />
            <span>Есть согласие на контакт</span>
          </label>
          {errors.consent && <span className="error-text">{errors.consent}</span>}
          <button type="submit" className="button">
            <Plus size={17} />
            Добавить лида
          </button>
        </form>
      </section>
    </div>
  );
}

function CampaignsView({
  campaigns,
  campaignForm,
  setCampaignForm,
  addCampaign,
  errors
}: {
  campaigns: Campaign[];
  campaignForm: { name: string; audience: string; goal: string; consentOnly: boolean };
  setCampaignForm: (value: { name: string; audience: string; goal: string; consentOnly: boolean }) => void;
  addCampaign: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={Megaphone} title="Sequence builder" />
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <article className="campaign-row" key={campaign.id}>
              <div className="campaign-head">
                <div>
                  <strong>{campaign.name}</strong>
                  <small>{campaign.audience} - {campaign.tone}</small>
                </div>
                <span className={`risk ${campaign.risk}`}>{campaignLabels[campaign.status]}</span>
              </div>
              <div className="message-stack">
                {campaign.messages.map((message, index) => (
                  <div className="message-row" key={message}>
                    <span>{index + 1}</span>
                    <p>{message}</p>
                    <button type="button" className="mini-button" title="Копировать">
                      <Copy size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={WandSparkles} title="Новая кампания" />
        <form className="form" onSubmit={addCampaign}>
          <Field label="Название" error={errors.name}>
            <input
              value={campaignForm.name}
              onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })}
            />
          </Field>
          <Field label="Сегмент" error={errors.audience}>
            <input
              value={campaignForm.audience}
              onChange={(event) => setCampaignForm({ ...campaignForm, audience: event.target.value })}
            />
          </Field>
          <Field label="Цель" error={errors.goal}>
            <select
              value={campaignForm.goal}
              onChange={(event) => setCampaignForm({ ...campaignForm, goal: event.target.value })}
            >
              <option value="demo">Демо</option>
              <option value="audit">Аудит</option>
              <option value="partner">Партнерство</option>
              <option value="reactivation">Реактивация</option>
            </select>
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={campaignForm.consentOnly}
              onChange={(event) => setCampaignForm({ ...campaignForm, consentOnly: event.target.checked })}
            />
            <span>Только opt-in база</span>
          </label>
          {errors.consentOnly && <span className="error-text">{errors.consentOnly}</span>}
          <button type="submit" className="button">
            <Sparkles size={17} />
            Сгенерировать
          </button>
        </form>
      </section>
    </div>
  );
}

function CommentsView({
  rules,
  selectedRuleId,
  setSelectedRuleId,
  ruleForm,
  setRuleForm,
  addRule,
  errors,
  postText,
  setPostText,
  draftResult,
  copyDraft,
  sendTelegramComment,
  generateAiComments,
  telegramForm,
  setTelegramForm,
  gatewayConfig,
  setGatewayConfig,
  eventPersonas,
  personaForm,
  setPersonaForm,
  addPersona,
  removePersona,
  togglePersona,
  dialogueForm,
  setDialogueForm,
  generateEventDialogue,
  eventDialogue,
  gatewayStatus,
  copyEventDialogue,
  serverInfo
}: {
  rules: AiCommentRule[];
  selectedRuleId: number;
  setSelectedRuleId: (id: number) => void;
  ruleForm: {
    channel: string;
    persona: string;
    tone: string;
    goal: string;
    maxPerDay: string;
    manualApproval: boolean;
    avoidSalesPitch: boolean;
    signature: string;
    stopWords: string;
  };
  setRuleForm: (value: {
    channel: string;
    persona: string;
    tone: string;
    goal: string;
    maxPerDay: string;
    manualApproval: boolean;
    avoidSalesPitch: boolean;
    signature: string;
    stopWords: string;
  }) => void;
  addRule: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
  postText: string;
  setPostText: (value: string) => void;
  draftResult: DraftResult;
  copyDraft: (draft: string) => void;
  sendTelegramComment: (draft: string) => void;
  generateAiComments: () => void;
  telegramForm: { discussionChatId: string; replyToMessageId: string; confirmedOwnChannel: boolean };
  setTelegramForm: (value: { discussionChatId: string; replyToMessageId: string; confirmedOwnChannel: boolean }) => void;
  gatewayConfig: XedocGatewayConfig;
  setGatewayConfig: (value: XedocGatewayConfig) => void;
  eventPersonas: EventPersona[];
  personaForm: EventPersonaFormState;
  setPersonaForm: (value: EventPersonaFormState) => void;
  addPersona: (event: FormEvent<HTMLFormElement>) => void;
  removePersona: (id: number) => void;
  togglePersona: (persona: EventPersona) => void;
  dialogueForm: EventDialogueFormState;
  setDialogueForm: (value: EventDialogueFormState) => void;
  generateEventDialogue: (event: FormEvent<HTMLFormElement>) => void;
  eventDialogue: EventDialogueTurn[];
  gatewayStatus: GatewayStatus;
  copyEventDialogue: () => void;
  serverInfo: { xedocConfigured: boolean; telegramPostingConfigured: boolean };
}) {
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? rules[0];

  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={MessageSquareText} title="AI-комментарии под постами" />
        <div className="comment-workbench">
          <div className="rule-list">
            {rules.map((rule) => (
              <button
                type="button"
                className={rule.id === selectedRule?.id ? "rule-card active" : "rule-card"}
                key={rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
              >
                <div>
                  <strong>{rule.channel}</strong>
                  <small>{describeCommentTone(rule.tone)} · {describeCommentGoal(rule.goal)}</small>
                </div>
                <span>{rule.maxPerDay}/день</span>
              </button>
            ))}
          </div>

          <div className="comment-generator">
            <div className="comment-policy">
              <ShieldCheck size={18} />
              <span>Только черновики: ручное подтверждение, без автопостинга и без прямого sales pitch.</span>
            </div>
            <Field label="Текст поста для черновика" error={draftResult.error}>
              <textarea value={postText} onChange={(event) => setPostText(event.target.value)} />
            </Field>
            <div className="command-actions">
              <button type="button" className="button" onClick={generateAiComments} disabled={draftResult.loading}>
                <Sparkles size={17} />
                {draftResult.loading ? "Генерирую..." : "Сгенерировать через xedoc.ru"}
              </button>
              <span className={`status-pill ${serverInfo.xedocConfigured ? "success" : "error"}`}>
                {serverInfo.xedocConfigured ? "AI gateway online" : "AI gateway off"}
              </span>
            </div>
            <div className="telegram-send-panel">
              <div className="form-grid two">
                <Field label="Discussion chat ID">
                  <input
                    value={telegramForm.discussionChatId}
                    onChange={(event) => setTelegramForm({ ...telegramForm, discussionChatId: event.target.value })}
                    placeholder="-100..."
                  />
                </Field>
                <Field label="Reply message ID">
                  <input
                    type="number"
                    min="1"
                    value={telegramForm.replyToMessageId}
                    onChange={(event) => setTelegramForm({ ...telegramForm, replyToMessageId: event.target.value })}
                    placeholder="optional"
                  />
                </Field>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={telegramForm.confirmedOwnChannel}
                  onChange={(event) => setTelegramForm({ ...telegramForm, confirmedOwnChannel: event.target.checked })}
                />
                <span>Канал свой или согласован для event-комментариев</span>
              </label>
            </div>
            <div className="message-stack">
              {draftResult.drafts.map((draft, index) => (
                <div className="message-row comment-draft" key={draft}>
                  <span>{index + 1}</span>
                  <p>{draft}</p>
                  <div className="message-actions">
                  <button type="button" className="mini-button" title="Копировать" onClick={() => copyDraft(draft)}>
                    <Copy size={15} />
                  </button>
                    <button
                      type="button"
                      className="mini-button"
                      title="Отправить ботом"
                      onClick={() => sendTelegramComment(draft)}
                      disabled={!serverInfo.telegramPostingConfigured || !telegramForm.discussionChatId.trim() || !telegramForm.confirmedOwnChannel}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={Settings} title="Новое правило" />
        <form className="form" onSubmit={addRule}>
          <Field label="Канал" error={errors.channel}>
            <input
              value={ruleForm.channel}
              onChange={(event) => setRuleForm({ ...ruleForm, channel: event.target.value })}
              placeholder="@channel"
            />
          </Field>
          <Field label="Роль ИИ" error={errors.persona}>
            <textarea
              value={ruleForm.persona}
              onChange={(event) => setRuleForm({ ...ruleForm, persona: event.target.value })}
            />
          </Field>
          <Field label="Тон" error={errors.tone}>
            <select value={ruleForm.tone} onChange={(event) => setRuleForm({ ...ruleForm, tone: event.target.value })}>
              <option value="expert">Экспертный</option>
              <option value="friendly">Дружелюбный</option>
              <option value="founder">Основатель</option>
              <option value="supportive">Поддерживающий</option>
            </select>
          </Field>
          <Field label="Цель" error={errors.goal}>
            <select value={ruleForm.goal} onChange={(event) => setRuleForm({ ...ruleForm, goal: event.target.value })}>
              <option value="value">Добавить пользу</option>
              <option value="question">Задать вопрос</option>
              <option value="partner">Партнерство</option>
              <option value="clarify">Уточнить</option>
            </select>
          </Field>
          <Field label="Лимит в день" error={errors.maxPerDay}>
            <input
              type="number"
              min="1"
              max="5"
              value={ruleForm.maxPerDay}
              onChange={(event) => setRuleForm({ ...ruleForm, maxPerDay: event.target.value })}
            />
          </Field>
          <Field label="Подпись" error={errors.signature}>
            <input
              value={ruleForm.signature}
              onChange={(event) => setRuleForm({ ...ruleForm, signature: event.target.value })}
            />
          </Field>
          <Field label="Стоп-слова" error={errors.stopWords}>
            <input
              value={ruleForm.stopWords}
              onChange={(event) => setRuleForm({ ...ruleForm, stopWords: event.target.value })}
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={ruleForm.manualApproval}
              onChange={(event) => setRuleForm({ ...ruleForm, manualApproval: event.target.checked })}
            />
            <span>Ручное подтверждение</span>
          </label>
          {errors.manualApproval && <span className="error-text">{errors.manualApproval}</span>}
          <label className="check-row">
            <input
              type="checkbox"
              checked={ruleForm.avoidSalesPitch}
              onChange={(event) => setRuleForm({ ...ruleForm, avoidSalesPitch: event.target.checked })}
            />
            <span>Без прямого sales pitch</span>
          </label>
          {errors.avoidSalesPitch && <span className="error-text">{errors.avoidSalesPitch}</span>}
          <button type="submit" className="button">
            <Plus size={17} />
            Добавить правило
          </button>
        </form>
      </section>

      <section className="section wide">
        <SectionHeader icon={Bot} title="Диалог события под постом" />
        <form className="form event-dialogue-form" onSubmit={generateEventDialogue}>
          <div className="comment-policy">
            <ShieldCheck size={18} />
            <span>Event-аккаунты здесь являются согласованными ролями для собственного или согласованного канала. Система готовит черновики, публикация остается ручной.</span>
          </div>
          <div className="form-grid two">
            <Field label="Канал" error={errors.channel}>
              <input
                value={dialogueForm.channel}
                onChange={(event) => setDialogueForm({ ...dialogueForm, channel: event.target.value })}
                placeholder="@channel"
              />
            </Field>
            <Field label="Ссылка на пост" error={errors.postUrl}>
              <input
                value={dialogueForm.postUrl}
                onChange={(event) => setDialogueForm({ ...dialogueForm, postUrl: event.target.value })}
                placeholder="https://t.me/channel/123"
              />
            </Field>
          </div>
          <Field label="Тема диалога" error={errors.topic}>
            <input
              value={dialogueForm.topic}
              onChange={(event) => setDialogueForm({ ...dialogueForm, topic: event.target.value })}
            />
          </Field>
          <Field label="Текст поста" error={errors.postText}>
            <textarea
              className="event-post-input"
              value={dialogueForm.postText}
              onChange={(event) => setDialogueForm({ ...dialogueForm, postText: event.target.value })}
            />
          </Field>
          <div className="activity-lab">
            <div className="form-grid four">
              <Field label="Триггер" error={errors.triggerMode}>
                <select value={dialogueForm.triggerMode} onChange={(event) => setDialogueForm({ ...dialogueForm, triggerMode: event.target.value as EventDialogueFormState["triggerMode"] })}>
                  <option value="manual">Ручной запуск</option>
                  <option value="new_post">Новый пост</option>
                  <option value="scheduled">По расписанию</option>
                </select>
              </Field>
              <Field label="Интенсивность" error={errors.intensity}>
                <select value={dialogueForm.intensity} onChange={(event) => setDialogueForm({ ...dialogueForm, intensity: event.target.value as EventDialogueFormState["intensity"] })}>
                  <option value="calm">Спокойно</option>
                  <option value="balanced">Баланс</option>
                  <option value="active">Активно</option>
                  <option value="heated">Жарко</option>
                </select>
              </Field>
              <Field label="Динамика" error={errors.dynamics}>
                <select value={dialogueForm.dynamics} onChange={(event) => setDialogueForm({ ...dialogueForm, dynamics: event.target.value as EventDialogueFormState["dynamics"] })}>
                  <option value="mixed">Смешанная</option>
                  <option value="supportive">Поддержка</option>
                  <option value="debate">Спор</option>
                  <option value="qa">Вопросы</option>
                  <option value="painstorm">Боли</option>
                </select>
              </Field>
              <Field label="Ответы" error={errors.replyTarget}>
                <select value={dialogueForm.replyTarget} onChange={(event) => setDialogueForm({ ...dialogueForm, replyTarget: event.target.value as EventDialogueFormState["replyTarget"] })}>
                  <option value="mixed">Пост + ветка</option>
                  <option value="post">Только к посту</option>
                  <option value="previous">На предыдущих</option>
                </select>
              </Field>
            </div>
            <div className="form-grid two">
              <Field label="Настроение" error={errors.mood}>
                <input value={dialogueForm.mood} onChange={(event) => setDialogueForm({ ...dialogueForm, mood: event.target.value })} />
              </Field>
              <Field label="Цель эксперимента" error={errors.experimentGoal}>
                <input value={dialogueForm.experimentGoal} onChange={(event) => setDialogueForm({ ...dialogueForm, experimentGoal: event.target.value })} />
              </Field>
            </div>
            <Field label="Боли и мнения аудитории" error={errors.audiencePain}>
              <textarea
                value={dialogueForm.audiencePain}
                onChange={(event) => setDialogueForm({ ...dialogueForm, audiencePain: event.target.value })}
              />
            </Field>
          </div>
          <div className="form-grid two">
            <Field label="Реплик" error={errors.turns}>
              <input
                type="number"
                min="2"
                max="12"
                value={dialogueForm.turns}
                onChange={(event) => setDialogueForm({ ...dialogueForm, turns: event.target.value })}
              />
            </Field>
            <div className="status-panel">
              <span className={`status-pill ${gatewayStatus.state}`}>{gatewayStatus.state === "loading" ? "В работе" : gatewayStatus.state === "success" ? "Готово" : gatewayStatus.state === "error" ? "Ошибка" : "Ожидает"}</span>
              <small>{gatewayStatus.message || "Настройте gateway и запустите генерацию"}</small>
            </div>
          </div>
          <div className="checklist compact">
            <label className="check-row">
              <input
                type="checkbox"
                checked={dialogueForm.manualApproval}
                onChange={(event) => setDialogueForm({ ...dialogueForm, manualApproval: event.target.checked })}
              />
              <span>Ручное подтверждение каждой реплики</span>
            </label>
            {errors.manualApproval && <span className="error-text">{errors.manualApproval}</span>}
            <label className="check-row">
              <input
                type="checkbox"
                checked={dialogueForm.noAutoPost}
                onChange={(event) => setDialogueForm({ ...dialogueForm, noAutoPost: event.target.checked })}
              />
              <span>Автопостинг отключен</span>
            </label>
            {errors.noAutoPost && <span className="error-text">{errors.noAutoPost}</span>}
            <label className="check-row">
              <input
                type="checkbox"
                checked={dialogueForm.ownChannel}
                onChange={(event) => setDialogueForm({ ...dialogueForm, ownChannel: event.target.checked })}
              />
              <span>Канал свой или согласован для event</span>
            </label>
            {errors.ownChannel && <span className="error-text">{errors.ownChannel}</span>}
          </div>
          <div className="command-actions">
            <button type="submit" className="button" disabled={gatewayStatus.state === "loading"}>
              <Send size={17} />
              Создать диалог через xedoc.ru
            </button>
            <button type="button" className="button secondary" onClick={copyEventDialogue} disabled={!eventDialogue.length}>
              <Copy size={17} />
              Скопировать диалог
            </button>
          </div>
        </form>

        {eventDialogue.length > 0 && (
          <div className="dialogue-output">
            {eventDialogue.map((turn, index) => (
              <div className="message-row dialogue-turn" key={turn.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{turn.speaker} <small>{turn.account}</small></strong>
                  <p>{turn.reply}</p>
                </div>
                <button type="button" className="mini-button" title="Копировать" onClick={() => copyDraft(turn.reply)}>
                  <Copy size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <SectionHeader icon={Bot} title="xedoc.ru models" />
        <div className="form gateway-form">
          <div className="server-status-grid">
            <div className="status-panel">
              <span className={`status-pill ${serverInfo.xedocConfigured ? "success" : "error"}`}>
                {serverInfo.xedocConfigured ? "Gateway connected" : "Gateway missing"}
              </span>
              <small>MODEL_API_TOKEN хранится на сервере, не в браузере.</small>
            </div>
            <div className="status-panel">
              <span className={`status-pill ${serverInfo.telegramPostingConfigured ? "success" : "error"}`}>
                {serverInfo.telegramPostingConfigured ? "Telegram Bot API ready" : "Manual drafts mode"}
              </span>
              <small>Публикация доступна только через официального бота и подтверждение канала.</small>
            </div>
          </div>
          <div className="form-grid two">
            <Field label="Модель по умолчанию" error={errors.kind}>
              <select
                value={gatewayConfig.kind}
                onChange={(event) => setGatewayConfig({ ...gatewayConfig, kind: event.target.value as ModelProvider })}
              >
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Ожидание ответа, мс" error={errors.waitMs}>
            <input
              type="number"
              min="0"
              max="120000"
              step="5000"
              value={gatewayConfig.waitMs}
              onChange={(event) => setGatewayConfig({ ...gatewayConfig, waitMs: Number(event.target.value) })}
            />
          </Field>
        </div>

        <div className="persona-panel">
          <div className="section-header compact-header">
            <div>
              <UsersRound size={18} />
              <h2>Event-аккаунты</h2>
            </div>
          </div>
          <div className="persona-list">
            {eventPersonas.map((persona) => (
              <div className="persona-card" key={persona.id}>
                <div>
                  <strong>{persona.name}</strong>
                  <small>{persona.handle} · {providerLabels[persona.kind]} · {persona.enabled === false ? "off" : "on"}</small>
                  <p>{persona.role}</p>
                  {persona.topics && <p className="persona-topics">{persona.topics}</p>}
                </div>
                <div className="message-actions">
                  <button type="button" className="mini-button" title={persona.enabled === false ? "Включить" : "Выключить"} onClick={() => togglePersona(persona)}>
                    {persona.enabled === false ? <Check size={15} /> : <X size={15} />}
                  </button>
                  <button type="button" className="mini-button" title="Удалить" onClick={() => removePersona(persona.id)}>
                  <Trash2 size={15} />
                </button>
                </div>
              </div>
            ))}
          </div>
          <form className="form persona-form" onSubmit={addPersona}>
            <Field label="Имя" error={errors.name}>
              <input
                value={personaForm.name}
                onChange={(event) => setPersonaForm({ ...personaForm, name: event.target.value })}
              />
            </Field>
            <Field label="Метка аккаунта" error={errors.handle}>
              <input
                value={personaForm.handle}
                onChange={(event) => setPersonaForm({ ...personaForm, handle: event.target.value })}
                placeholder="@event_guest"
              />
            </Field>
            <Field label="Provider" error={errors.kind}>
              <select value={personaForm.kind} onChange={(event) => setPersonaForm({ ...personaForm, kind: event.target.value as ModelProvider })}>
                {Object.entries(providerLabels).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Темы" error={errors.topics}>
              <input
                value={personaForm.topics}
                onChange={(event) => setPersonaForm({ ...personaForm, topics: event.target.value })}
                placeholder="AI SaaS, objections, launch metrics"
              />
            </Field>
            <Field label="Роль" error={errors.role}>
              <textarea value={personaForm.role} onChange={(event) => setPersonaForm({ ...personaForm, role: event.target.value })} />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                checked={personaForm.enabled}
                onChange={(event) => setPersonaForm({ ...personaForm, enabled: event.target.checked })}
              />
              <span>Включить в генерацию диалога</span>
            </label>
            <button type="submit" className="button secondary">
              <Plus size={17} />
              Добавить event-аккаунт
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function ReportsView({
  channels,
  leads,
  totals
}: {
  channels: Channel[];
  leads: Lead[];
  totals: { pipeline: number; mrr: number; optInLeads: number; publicSignals: number; riskScore: number };
}) {
  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={ChartNoAxesCombined} title="Revenue report" />
        <div className="bars">
          {reportRows.map((row, index) => (
            <div className="bar-row" key={row.label}>
              <span>{row.label}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${58 + index * 8}%` }} />
              </div>
              <strong>{row.value}</strong>
              <small>{row.delta}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={Target} title="Юнит-экономика" />
        <div className="metric-list">
          <MetricRow label="MRR" value={`$${formatNumber(totals.mrr)}`} hint="оплаченные пилоты" />
          <MetricRow label="Pipeline" value={`$${formatNumber(totals.pipeline)}`} hint={`${leads.length} сделок`} />
          <MetricRow label="CAC payback" value="1.8 мес" hint="посевы + inbound" />
          <MetricRow label="Каналы" value={String(channels.length)} hint="публичный watchlist" />
        </div>
      </section>

      <section className="section wide">
        <SectionHeader icon={Flag} title="Каналы с потенциалом" />
        <div className="table">
          <div className="table-head">
            <span>Источник</span>
            <span>Участники</span>
            <span>Средние просмотры</span>
            <span>Постов/день</span>
          </div>
          {channels.map((channel) => (
            <div className="table-row" key={channel.id}>
              <strong>{channel.handle}</strong>
              <span>{formatNumber(channel.members)}</span>
              <span>{formatNumber(channel.avgViews)}</span>
              <span>{channel.postsPerDay}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SafetyView() {
  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={ShieldCheck} title="Compliance matrix" />
        <div className="safety-grid">
          {safetyMap.map((item) => (
            <div className="safety-row" key={item.unsafe}>
              <div className={item.state === "blocked" ? "safety-icon blocked" : "safety-icon active"}>
                {item.state === "blocked" ? <X size={18} /> : <Check size={18} />}
              </div>
              <div>
                <small>Не делаем</small>
                <strong>{item.unsafe}</strong>
              </div>
              <ChevronRight size={18} />
              <div>
                <small>Делаем</small>
                <strong>{item.safe}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader icon={Lock} title="Preflight" />
        <div className="checklist">
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            <span>Источник публичный</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            <span>Контакт дал согласие</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            <span>Нет скрытого парсинга</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked readOnly />
            <span>Текст без давления</span>
          </label>
        </div>
      </section>
    </div>
  );
}

function SettingsView({
  exportPlan,
  auth,
  users,
  userForm,
  setUserForm,
  createUser,
  serverInfo
}: {
  exportPlan: () => void;
  auth: AuthUser;
  users: AuthUser[];
  userForm: { username: string; password: string; role: string };
  setUserForm: (value: { username: string; password: string; role: string }) => void;
  createUser: (event: FormEvent<HTMLFormElement>) => void;
  serverInfo: { xedocConfigured: boolean; telegramPostingConfigured: boolean };
}) {
  return (
    <div className="view-grid">
      <section className="section wide">
        <SectionHeader icon={Settings} title="Деплой" />
        <div className="deploy-grid">
          <div>
            <small>Домен</small>
            <strong>tg.xedoc.ru</strong>
          </div>
          <div>
            <small>Локальный upstream</small>
            <strong>127.0.0.1:3021</strong>
          </div>
          <div>
            <small>Runtime</small>
            <strong>nginx + Node API + static build</strong>
          </div>
          <div>
            <small>xedoc.ru gateway</small>
            <strong>{serverInfo.xedocConfigured ? "connected" : "not configured"}</strong>
          </div>
          <div>
            <small>Telegram posting</small>
            <strong>{serverInfo.telegramPostingConfigured ? "bot configured" : "manual drafts"}</strong>
          </div>
        </div>
      </section>

      {auth.role === "admin" && (
        <section className="section wide">
          <SectionHeader icon={UsersRound} title="Пользователи" />
          <div className="user-list">
            {users.map((user) => (
              <div className="user-row" key={user.id}>
                <div>
                  <strong>{user.username}</strong>
                  <small>{user.role}</small>
                </div>
                <span>{user.createdAt ? new Date(user.createdAt).toLocaleDateString("ru-RU") : "new"}</span>
              </div>
            ))}
          </div>
          <form className="form user-form" onSubmit={createUser}>
            <div className="form-grid three">
              <Field label="Логин">
                <input
                  value={userForm.username}
                  onChange={(event) => setUserForm({ ...userForm, username: event.target.value })}
                  placeholder="manager"
                />
              </Field>
              <Field label="Пароль">
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                  placeholder="8+ символов"
                />
              </Field>
              <Field label="Роль">
                <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </Field>
            </div>
            <button type="submit" className="button">
              <Plus size={17} />
              Создать пользователя
            </button>
          </form>
        </section>
      )}

      <section className="section">
        <SectionHeader icon={ClipboardCheck} title="Операции" />
        <div className="action-stack">
          <button type="button" className="button" onClick={exportPlan}>
            <Download size={17} />
            Экспорт JSON
          </button>
          <button type="button" className="button secondary">
            <Link size={17} />
            Проверить DNS
          </button>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  action,
  onAction
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-header">
      <div>
        <Icon size={19} />
        <h2>{title}</h2>
      </div>
      {action && (
        <button type="button" className="text-button" onClick={onAction}>
          {action}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <small className="error-text">{error}</small>}
    </label>
  );
}

function MetricRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="metric-row">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <span>{value}</span>
    </div>
  );
}

export default App;
