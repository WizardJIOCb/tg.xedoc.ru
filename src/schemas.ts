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

export type PublicTelegramSourceInput = z.infer<typeof publicTelegramSourceSchema>;
export type LeadInput = z.infer<typeof leadSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
