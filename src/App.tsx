import {
  Activity,
  BadgeCheck,
  BellRing,
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
  UsersRound,
  WandSparkles,
  X
} from "lucide-react";
import { type ComponentType, type FormEvent, useMemo, useState } from "react";
import {
  type AiCommentRule,
  type Campaign,
  type CampaignStatus,
  type Channel,
  type ChannelRisk,
  type Lead,
  type LeadStage,
  type NavKey,
  keywordWeights,
  reportRows,
  safetyMap,
  seedCampaigns,
  seedChannels,
  seedCommentRules,
  seedLeads,
  seedTasks
} from "./data";
import {
  aiCommentRuleSchema,
  campaignSchema,
  commentPostSchema,
  keywordSchema,
  leadSchema,
  publicTelegramSourceSchema
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

function App() {
  const [active, setActive] = useState<NavKey>("dashboard");
  const [channels, setChannels] = usePersistentState<Channel[]>("tg-hunter.channels", seedChannels);
  const [leads, setLeads] = usePersistentState<Lead[]>("tg-hunter.leads", seedLeads);
  const [campaigns, setCampaigns] = usePersistentState<Campaign[]>("tg-hunter.campaigns", seedCampaigns);
  const [commentRules, setCommentRules] = usePersistentState<AiCommentRule[]>(
    "tg-hunter.commentRules",
    seedCommentRules
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

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const addChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = publicTelegramSourceSchema.safeParse(sourceForm);
    if (!parsed.success) {
      setErrors(getFieldErrors(parsed.error));
      return;
    }

    const source = parsed.data.source.startsWith("https://t.me/")
      ? `@${parsed.data.source.split("/").filter(Boolean).at(-1) ?? ""}`
      : parsed.data.source;

    const nextChannel: Channel = {
      id: Date.now(),
      title: titleFromHandle(source),
      handle: source,
      topic: parsed.data.topic,
      members: 8000 + Math.floor(Math.random() * 38000),
      growth: Number((4 + Math.random() * 11).toFixed(1)),
      engagement: Number((5 + Math.random() * 9).toFixed(1)),
      avgViews: 2500 + Math.floor(Math.random() * 12000),
      postsPerDay: 1 + Math.floor(Math.random() * 4),
      source: "manual",
      risk: "low",
      keywords: [parsed.data.topic.toLowerCase(), "telegram", "research"],
      lastSignal: parsed.data.note || "добавлен в ручную проверку",
      status: "candidate"
    };

    setChannels((previous) => [nextChannel, ...previous]);
    setSourceForm({ source: "@", topic: "", note: "" });
    setErrors({});
    showToast("Источник добавлен в радар");
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

  const exportPlan = () => {
    const payload = {
      product: "TG Hunter",
      domain: "tg.xedoc.ru",
      generatedAt: new Date().toISOString(),
      policy: "public sources and opt-in contacts only",
      channels,
      leads,
      campaigns,
      commentRules
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
            <button type="button" className="icon-button" title="Экспорт" onClick={exportPlan}>
              <Download size={18} />
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
            draftResult={commentDraftResult}
            copyDraft={copyCommentDraft}
          />
        )}

        {active === "reports" && <ReportsView channels={channels} leads={leads} totals={totals} />}

        {active === "safety" && <SafetyView />}

        {active === "settings" && <SettingsView exportPlan={exportPlan} />}
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
  copyDraft
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
  draftResult: { drafts: string[]; error: string };
  copyDraft: (draft: string) => void;
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
            <div className="message-stack">
              {draftResult.drafts.map((draft, index) => (
                <div className="message-row comment-draft" key={draft}>
                  <span>{index + 1}</span>
                  <p>{draft}</p>
                  <button type="button" className="mini-button" title="Копировать" onClick={() => copyDraft(draft)}>
                    <Copy size={15} />
                  </button>
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

function SettingsView({ exportPlan }: { exportPlan: () => void }) {
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
            <strong>127.0.0.1:3010</strong>
          </div>
          <div>
            <small>Runtime</small>
            <strong>nginx + static build</strong>
          </div>
        </div>
      </section>

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
