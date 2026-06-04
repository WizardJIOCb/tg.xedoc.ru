import { z } from "zod";

export const publicTelegramSourceSchema = z.object({
  source: z
    .string()
    .trim()
    .min(3, "Укажите публичный @handle или ссылку")
    .max(96, "Слишком длинный источник")
    .refine(
      (value) =>
        /^@[a-zA-Z0-9_]{5,32}$/.test(value) ||
        /^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(value),
      "Нужен формат @channel или https://t.me/channel"
    ),
  topic: z.string().trim().min(2, "Укажите нишу").max(48, "Ниша слишком длинная"),
  note: z.string().trim().max(160, "Заметка слишком длинная").optional()
});

export const leadSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя или компанию").max(64, "Название слишком длинное"),
  source: z.string().trim().min(2, "Укажите источник").max(64, "Источник слишком длинный"),
  value: z.coerce.number().min(0, "Бюджет не может быть отрицательным").max(1000000, "Слишком высокий бюджет"),
  consent: z.boolean().refine(Boolean, "Нужен opt-in или договорное основание"),
  notes: z.string().trim().max(180, "Заметка слишком длинная").optional()
});

export const campaignSchema = z.object({
  name: z.string().trim().min(3, "Укажите название кампании").max(72, "Название слишком длинное"),
  audience: z.string().trim().min(3, "Укажите сегмент").max(72, "Сегмент слишком длинный"),
  goal: z.enum(["demo", "audit", "partner", "reactivation"]),
  consentOnly: z.boolean().refine(Boolean, "Кампания доступна только для opt-in базы")
});

export const keywordSchema = z.object({
  text: z.string().trim().min(8, "Добавьте текст поста или подборку сообщений").max(1800, "Слишком много текста")
});

export const aiCommentRuleSchema = z.object({
  channel: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^@[a-zA-Z0-9_]{5,32}$/.test(value) ||
        /^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(value),
      "Нужен публичный @channel или https://t.me/channel"
    ),
  persona: z.string().trim().min(12, "Опишите роль ИИ подробнее").max(180, "Роль слишком длинная"),
  tone: z.enum(["expert", "friendly", "founder", "supportive"]),
  goal: z.enum(["value", "question", "partner", "clarify"]),
  maxPerDay: z.coerce.number().int().min(1, "Минимум 1").max(5, "Не больше 5 в день"),
  manualApproval: z.boolean().refine(Boolean, "Комментарии доступны только с ручным подтверждением"),
  avoidSalesPitch: z.boolean().refine(Boolean, "Нужен запрет на прямой sales pitch"),
  signature: z.string().trim().min(2, "Укажите подпись").max(32, "Подпись слишком длинная"),
  stopWords: z.string().trim().max(160, "Стоп-слова слишком длинные").optional()
});

export const commentPostSchema = z.object({
  text: z.string().trim().min(20, "Добавьте текст поста").max(1200, "Пост слишком длинный")
});

export const modelProviderSchema = z.enum(["codex", "grok", "gemini-cli", "gemini"]);

export const xedocGatewayConfigSchema = z.object({
  baseUrl: z.string().trim().url("Нужен URL xedoc.ru API").max(160, "URL слишком длинный"),
  token: z.string().trim().min(12, "Укажите bearer-token gateway").max(300, "Токен слишком длинный"),
  agentId: z.string().trim().max(80, "agentId слишком длинный").optional(),
  repoId: z.string().trim().max(80, "repoId слишком длинный").optional(),
  kind: modelProviderSchema,
  model: z.string().trim().max(80, "Модель слишком длинная").optional(),
  waitMs: z.coerce.number().int().min(0, "Минимум 0").max(120000, "Максимум 120 секунд")
});

export const eventPersonaSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(48, "Имя слишком длинное"),
  handle: z
    .string()
    .trim()
    .min(2, "Укажите метку аккаунта")
    .max(40, "Метка слишком длинная")
    .refine((value) => /^@[a-zA-Z0-9_]{3,32}$/.test(value), "Формат @account_label"),
  role: z.string().trim().min(12, "Опишите роль подробнее").max(220, "Роль слишком длинная"),
  topics: z.string().trim().max(300, "Topics are too long").optional().default(""),
  kind: modelProviderSchema,
  enabled: z.boolean().optional().default(true)
});

export const eventDialogueSchema = z.object({
  channel: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^@[a-zA-Z0-9_]{5,32}$/.test(value) ||
        /^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(value),
      "Нужен публичный @channel или https://t.me/channel"
    ),
  postUrl: z.string().trim().max(240, "Ссылка слишком длинная").optional(),
  topic: z.string().trim().min(3, "Укажите тему").max(120, "Тема слишком длинная"),
  postText: z.string().trim().min(20, "Добавьте текст поста").max(2500, "Пост слишком длинный"),
  turns: z.coerce.number().int().min(2, "Минимум 2 реплики").max(12, "Максимум 12 реплик"),
  triggerMode: z.enum(["manual", "new_post", "scheduled"]).optional().default("manual"),
  intensity: z.enum(["calm", "balanced", "active", "heated"]).optional().default("balanced"),
  dynamics: z.enum(["supportive", "debate", "qa", "painstorm", "mixed"]).optional().default("mixed"),
  replyTarget: z.enum(["post", "previous", "mixed"]).optional().default("mixed"),
  mood: z.string().trim().max(160, "Mood is too long").optional().default("curious, useful"),
  audiencePain: z.string().trim().max(500, "Audience pain is too long").optional().default(""),
  experimentGoal: z.string().trim().max(320, "Experiment goal is too long").optional().default(""),
  manualApproval: z.boolean().refine(Boolean, "Нужно ручное подтверждение"),
  noAutoPost: z.boolean().refine(Boolean, "Автопостинг отключен"),
  ownChannel: z.boolean().refine(Boolean, "Используйте только свой канал/согласованный event")
});

export type PublicTelegramSourceInput = z.infer<typeof publicTelegramSourceSchema>;
export type LeadInput = z.infer<typeof leadSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type AiCommentRuleInput = z.infer<typeof aiCommentRuleSchema>;
export type XedocGatewayConfigInput = z.infer<typeof xedocGatewayConfigSchema>;
export type EventPersonaInput = z.infer<typeof eventPersonaSchema>;
export type EventDialogueInput = z.infer<typeof eventDialogueSchema>;
