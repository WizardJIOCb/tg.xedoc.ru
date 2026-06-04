import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv(resolve(rootDir, ".env"));

const config = {
  port: Number(process.env.PORT ?? 3021),
  dataPath: resolve(rootDir, process.env.DATA_PATH ?? "data/tg-hunter.json"),
  publicDir: resolve(rootDir, "dist"),
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  secureCookies: (process.env.NODE_ENV ?? "development") === "production",
  adminUsername: process.env.ADMIN_USERNAME ?? "rodion",
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  xedocBaseUrl: (process.env.XEDOC_MODEL_API_BASE ?? "https://xedoc.ru").replace(/\/+$/, ""),
  xedocToken: process.env.XEDOC_MODEL_API_TOKEN ?? process.env.MODEL_API_TOKEN,
  xedocAgentId: process.env.XEDOC_MODEL_API_AGENT_ID ?? "",
  xedocRepoId: process.env.XEDOC_MODEL_API_REPO_ID ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN
};

const publicTelegramSourceSchema = z.object({
  source: z.string().trim().min(3).max(96).refine(
    (value) => /^@[a-zA-Z0-9_]{5,32}$/.test(value) || /^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(value),
    "public_channel_required"
  ),
  topic: z.string().trim().min(2).max(48),
  note: z.string().trim().max(160).optional().default("")
});

const loginSchema = z.object({
  username: z.string().trim().min(2).max(48),
  password: z.string().min(6).max(200)
});

const userCreateSchema = z.object({
  username: z.string().trim().min(2).max(48).regex(/^[a-z0-9_.-]+$/i),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "user"]).default("user")
});

const commentGenerateSchema = z.object({
  channel: z.string().trim().min(3).max(96),
  postText: z.string().trim().min(10).max(4000),
  persona: z.string().trim().max(400).optional().default(""),
  tone: z.string().trim().max(80).optional().default("expert"),
  goal: z.string().trim().max(80).optional().default("value"),
  provider: z.enum(["codex", "grok", "gemini-cli", "gemini"]).default("codex"),
  count: z.coerce.number().int().min(1).max(5).default(3)
});

const eventDialogueSchema = z.object({
  channel: z.string().trim().min(3).max(96),
  postUrl: z.string().trim().max(240).optional().default(""),
  topic: z.string().trim().min(3).max(120),
  postText: z.string().trim().min(20).max(2500),
  turns: z.coerce.number().int().min(2).max(12),
  manualApproval: z.literal(true),
  noAutoPost: z.literal(true),
  ownChannel: z.literal(true),
  personas: z.array(z.object({
    id: z.number().int(),
    name: z.string().trim().min(2).max(48),
    handle: z.string().trim().min(2).max(40),
    role: z.string().trim().min(8).max(240),
    kind: z.enum(["codex", "grok", "gemini-cli", "gemini"])
  })).min(2).max(8)
});

const telegramSendSchema = z.object({
  commentId: z.number().int().optional(),
  text: z.string().trim().min(1).max(4096),
  discussionChatId: z.string().trim().min(3).max(80),
  replyToMessageId: z.coerce.number().int().positive().optional(),
  confirmedOwnChannel: z.literal(true)
});

const seedChannels = [
  channelRow("@aiproductlab", "AI SaaS", "public", 1),
  channelRow("@foundersignalsru", "B2B leads", "manual", 2),
  channelRow("@quietgrowth", "Marketing", "import", 3),
  channelRow("@secfounders", "Security", "public", 4)
];

const seedRules = [
  {
    id: 1,
    channel: "@aiproductlab",
    persona: "Founder and Telegram growth expert who writes useful comments without sales pressure.",
    tone: "expert",
    goal: "value",
    maxPerDay: 3,
    manualApproval: true,
    avoidSalesPitch: true,
    signature: "TG Hunter",
    stopWords: ["buy now", "guarantee", "spam"],
    enabled: true
  }
];

const store = loadStore();
bootstrapAdmin(store);
saveStore(store);

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    if (request.method === "OPTIONS") return sendNoContent(response);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    return sendStatic(response, url.pathname);
  } catch (error) {
    return sendJson(response, 500, { error: "server_error", message: error instanceof Error ? error.message : "unknown_error" });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`TG Hunter API listening on 127.0.0.1:${config.port}`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true, now: new Date().toISOString() });
  if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request, response);
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return logout(request, response);

  const auth = requireAuth(request, response);
  if (!auth) return;

  if (request.method === "GET" && url.pathname === "/api/me") {
    return sendJson(response, 200, { user: publicUser(auth.user), telegramPostingConfigured: Boolean(config.telegramBotToken) });
  }
  if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, statePayload(auth.user));
  if (request.method === "POST" && url.pathname === "/api/channels") return createChannel(request, response, auth.user);
  if (request.method === "POST" && url.pathname === "/api/comments/generate") return generateComments(request, response, auth.user);
  if (request.method === "POST" && url.pathname === "/api/event-dialogues/generate") return generateEventDialogue(request, response, auth.user);
  if (request.method === "POST" && url.pathname === "/api/telegram/send-comment") return sendTelegramComment(request, response, auth.user);
  if (url.pathname === "/api/users" && auth.user.role === "admin") {
    if (request.method === "GET") return sendJson(response, 200, { users: store.users.map(publicUser) });
    if (request.method === "POST") return createUser(request, response);
  }
  return sendJson(response, 404, { error: "not_found" });
}

async function login(request, response) {
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_login", details: parsed.error.flatten() });
  const username = parsed.data.username.toLowerCase();
  const user = store.users.find((item) => item.username.toLowerCase() === username);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return sendJson(response, 401, { error: "invalid_credentials" });
  const session = {
    id: token("ses"),
    userId: user.id,
    expiresAt: Date.now() + config.sessionDays * 24 * 60 * 60 * 1000,
    createdAt: new Date().toISOString()
  };
  store.sessions = store.sessions.filter((item) => item.expiresAt > Date.now() && item.userId !== user.id);
  store.sessions.push(session);
  saveStore(store);
  setCookie(response, "tg_session", session.id, config.sessionDays);
  return sendJson(response, 200, { user: publicUser(user), state: statePayload(user) });
}

function logout(request, response) {
  const sessionId = cookies(request).tg_session;
  if (sessionId) {
    store.sessions = store.sessions.filter((item) => item.id !== sessionId);
    saveStore(store);
  }
  clearCookie(response, "tg_session");
  return sendJson(response, 200, { ok: true });
}

async function createChannel(request, response, user) {
  const parsed = publicTelegramSourceSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_channel", details: parsed.error.flatten() });
  const handle = normalizeChannel(parsed.data.source);
  const existing = store.channels.find((item) => item.handle.toLowerCase() === handle.toLowerCase());
  if (existing) return sendJson(response, 409, { error: "channel_exists", channel: existing });
  const row = {
    ...channelRow(handle, parsed.data.topic, "manual", nextId(store.channels)),
    lastSignal: parsed.data.note || "Added by user",
    createdBy: user.id,
    createdAt: new Date().toISOString()
  };
  store.channels.unshift(row);
  saveStore(store);
  return sendJson(response, 201, { channel: row, channels: store.channels });
}

async function generateComments(request, response, user) {
  const parsed = commentGenerateSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_comment_request", details: parsed.error.flatten() });
  const drafts = await aiCommentDrafts(parsed.data).catch(() => localCommentDrafts(parsed.data));
  const saved = drafts.map((text) => ({
    id: nextId(store.comments),
    userId: user.id,
    channel: normalizeChannel(parsed.data.channel),
    postText: parsed.data.postText,
    text,
    status: "draft",
    createdAt: new Date().toISOString()
  }));
  store.comments.unshift(...saved);
  saveStore(store);
  return sendJson(response, 200, { drafts, comments: saved });
}

async function generateEventDialogue(request, response, user) {
  const parsed = eventDialogueSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_dialogue", details: parsed.error.flatten() });
  const turns = [];
  for (let index = 1; index <= parsed.data.turns; index += 1) {
    const persona = parsed.data.personas[(index - 1) % parsed.data.personas.length];
    const reply = await aiDialogueTurn(parsed.data, persona, turns, index).catch(() => localDialogueTurn(parsed.data, persona, turns, index));
    turns.push({ id: Date.now() + index, speaker: persona.name, account: persona.handle, reply });
  }
  const dialogue = {
    id: nextId(store.dialogues),
    userId: user.id,
    channel: normalizeChannel(parsed.data.channel),
    topic: parsed.data.topic,
    turns,
    status: "draft",
    createdAt: new Date().toISOString()
  };
  store.dialogues.unshift(dialogue);
  saveStore(store);
  return sendJson(response, 200, { turns, dialogue });
}

async function sendTelegramComment(request, response, user) {
  const parsed = telegramSendSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_telegram_request", details: parsed.error.flatten() });
  if (!config.telegramBotToken) return sendJson(response, 501, { error: "telegram_bot_not_configured" });
  const payload = {
    chat_id: parsed.data.discussionChatId,
    text: parsed.data.text,
    ...(parsed.data.replyToMessageId ? { reply_to_message_id: parsed.data.replyToMessageId, allow_sending_without_reply: true } : {})
  };
  const responseTelegram = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await responseTelegram.json().catch(() => ({}));
  if (!responseTelegram.ok || !result.ok) return sendJson(response, 502, { error: "telegram_send_failed", details: result.description ?? "telegram_error" });
  if (parsed.data.commentId) {
    const comment = store.comments.find((item) => item.id === parsed.data.commentId);
    if (comment) {
      comment.status = "sent";
      comment.sentBy = user.id;
      comment.sentAt = new Date().toISOString();
      comment.telegramMessageId = result.result?.message_id;
      saveStore(store);
    }
  }
  return sendJson(response, 200, { ok: true, telegramMessageId: result.result?.message_id });
}

async function createUser(request, response) {
  const parsed = userCreateSchema.safeParse(await readJson(request));
  if (!parsed.success) return sendJson(response, 400, { error: "invalid_user", details: parsed.error.flatten() });
  const username = parsed.data.username.toLowerCase();
  if (store.users.some((item) => item.username.toLowerCase() === username)) return sendJson(response, 409, { error: "user_exists" });
  const user = {
    id: token("usr"),
    username: parsed.data.username,
    role: parsed.data.role,
    passwordHash: hashPassword(parsed.data.password),
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  saveStore(store);
  return sendJson(response, 201, { user: publicUser(user), users: store.users.map(publicUser) });
}

async function aiCommentDrafts(input) {
  const prompt = [
    "Create Telegram comment drafts for a public channel post.",
    "Rules: transparent manual-review drafts only; no fake independent users; no spam; no aggressive sales; Russian language.",
    `Channel: ${normalizeChannel(input.channel)}`,
    `Persona: ${input.persona || "helpful event participant"}`,
    `Tone: ${input.tone}`,
    `Goal: ${input.goal}`,
    `Post: ${input.postText}`,
    `Return exactly ${input.count} comments as a JSON array of strings. Each comment: 1-3 sentences, under 500 characters.`
  ].join("\n");
  const text = await xedocPrompt(`TG Hunter comments ${normalizeChannel(input.channel)}`, prompt, input.provider);
  const parsed = parseStringArray(text);
  return parsed.length ? parsed.slice(0, input.count) : localCommentDrafts(input);
}

async function aiDialogueTurn(input, persona, turns, index) {
  const previous = turns.length ? turns.map((turn) => `${turn.speaker} (${turn.account}): ${turn.reply}`).join("\n") : "No comments yet.";
  const prompt = [
    "Generate one Telegram discussion comment draft.",
    "Rules: transparent event persona, manual approval only, no autoposting, no fake organic hype, no spam.",
    `Channel: ${normalizeChannel(input.channel)}`,
    input.postUrl ? `Post URL: ${input.postUrl}` : "",
    `Topic: ${input.topic}`,
    `Post: ${input.postText}`,
    `Current turn: ${index}`,
    `Speaker: ${persona.name} (${persona.handle})`,
    `Role: ${persona.role}`,
    "Previous dialogue:",
    previous,
    "Return only the comment text in Russian, 1-3 sentences, under 450 characters."
  ].filter(Boolean).join("\n");
  const text = await xedocPrompt(`TG Hunter dialogue ${normalizeChannel(input.channel)}`, prompt, persona.kind);
  return cleanText(text) || localDialogueTurn(input, persona, turns, index);
}

async function xedocPrompt(title, prompt, kind) {
  if (!config.xedocToken) throw new Error("xedoc_token_missing");
  const chat = await xedocRequest("/api/external/model/chats", {
    title: title.slice(0, 160),
    agentId: config.xedocAgentId || undefined,
    repoId: config.xedocRepoId || undefined,
    source: "tg-hunter",
    externalId: `tg-hunter:${Date.now()}`,
    systemPrompt: "TG Hunter server-side AI generation. Drafts for manual approval only."
  });
  const run = await xedocRequest(`/api/external/model/chats/${encodeURIComponent(chat.chatId)}/messages`, {
    kind,
    prompt,
    displayPrompt: title,
    waitMs: 90000
  });
  return run.finalMessage ?? run.job?.finalMessage ?? "";
}

async function xedocRequest(path, body) {
  const response = await fetch(`${config.xedocBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Origin: "https://tg.xedoc.ru",
      Authorization: `Bearer ${config.xedocToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "xedoc_error");
  return payload;
}

function localCommentDrafts(input) {
  const channel = normalizeChannel(input.channel);
  const topic = input.postText.replace(/\s+/g, " ").trim().slice(0, 130);
  return [
    `Хороший повод обсудить практику. Я бы отдельно посмотрел, какие вопросы уже повторяются в комментариях ${channel}: там обычно видно настоящий спрос, а не просто охват.`,
    `В посте сильный сигнал: "${topic}${topic.length >= 130 ? "..." : ""}". Для проверки гипотезы я бы сравнил 3-5 похожих каналов по ER, вопросам и темам обсуждений.`,
    "Согласен с направлением. Самый полезный следующий шаг - собрать короткий список публичных обсуждений, где люди уже формулируют проблему своими словами."
  ].slice(0, input.count);
}

function localDialogueTurn(input, persona, turns, index) {
  if (index === 1) return `Мне нравится, что тема вынесена в обсуждение, а не просто в анонс. По ${input.topic.toLowerCase()} важнее всего увидеть реальные вопросы аудитории под постом.`;
  const previous = turns.at(-1)?.reply ?? "";
  if (/вопрос|как|почему/i.test(previous)) return "Я бы проверил это на маленьком ручном тесте: 2-3 комментария, явная маркировка роли и обязательное согласование перед публикацией.";
  return "Да, и здесь важно не превращать комментарии в рекламу. Лучше добавлять опыт, уточняющий вопрос или пример, который помогает автору поста продолжить разговор.";
}

function parseStringArray(text) {
  const cleaned = cleanText(text);
  const match = cleaned.match(/\[[\s\S]*\]/);
  const source = match?.[0] ?? cleaned;
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").map(cleanText).filter(Boolean) : [];
  } catch {
    return cleaned.split(/\n+/).map((line) => cleanText(line.replace(/^\d+[\).:-]\s*/, ""))).filter(Boolean).slice(0, 5);
  }
}

function statePayload(user) {
  return {
    user: publicUser(user),
    channels: store.channels,
    commentRules: store.commentRules,
    comments: store.comments.filter((item) => user.role === "admin" || item.userId === user.id).slice(0, 50),
    dialogues: store.dialogues.filter((item) => user.role === "admin" || item.userId === user.id).slice(0, 20),
    users: user.role === "admin" ? store.users.map(publicUser) : [],
    xedocConfigured: Boolean(config.xedocToken),
    telegramPostingConfigured: Boolean(config.telegramBotToken)
  };
}

function requireAuth(request, response) {
  const sessionId = cookies(request).tg_session;
  const session = sessionId ? store.sessions.find((item) => item.id === sessionId && item.expiresAt > Date.now()) : undefined;
  if (!session) {
    sendJson(response, 401, { error: "unauthorized" });
    return null;
  }
  const user = store.users.find((item) => item.id === session.userId);
  if (!user) {
    sendJson(response, 401, { error: "unauthorized" });
    return null;
  }
  return { user, session };
}

function bootstrapAdmin(nextStore) {
  const passwordHash = config.adminPasswordHash || (config.adminPassword ? hashPassword(config.adminPassword) : "");
  if (!passwordHash) {
    if (!nextStore.users.some((user) => user.role === "admin")) {
      console.warn("ADMIN_PASSWORD_HASH or ADMIN_PASSWORD is required to create the first admin.");
    }
    return;
  }
  const existing = nextStore.users.find((user) => user.username.toLowerCase() === config.adminUsername.toLowerCase());
  if (existing) {
    existing.role = "admin";
    existing.passwordHash = passwordHash;
    existing.updatedAt = new Date().toISOString();
    return;
  }
  nextStore.users.push({
    id: token("usr"),
    username: config.adminUsername,
    role: "admin",
    passwordHash,
    createdAt: new Date().toISOString()
  });
}

function loadStore() {
  mkdirSync(dirname(config.dataPath), { recursive: true });
  if (!existsSync(config.dataPath)) {
    return { users: [], sessions: [], channels: seedChannels, commentRules: seedRules, comments: [], dialogues: [] };
  }
  const parsed = JSON.parse(readFileSync(config.dataPath, "utf8"));
  return {
    users: parsed.users ?? [],
    sessions: parsed.sessions ?? [],
    channels: parsed.channels ?? seedChannels,
    commentRules: parsed.commentRules ?? seedRules,
    comments: parsed.comments ?? [],
    dialogues: parsed.dialogues ?? []
  };
}

function saveStore(nextStore) {
  mkdirSync(dirname(config.dataPath), { recursive: true });
  const temp = `${config.dataPath}.tmp`;
  const safeStore = { ...nextStore, sessions: nextStore.sessions.filter((item) => item.expiresAt > Date.now()) };
  writeFileSync(temp, JSON.stringify(safeStore, null, 2));
  renameSync(temp, config.dataPath);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$210000$${salt}$${hash}`;
}

function verifyPassword(password, encoded) {
  const [scheme, iterations, salt, hash] = String(encoded ?? "").split("$");
  if (scheme !== "pbkdf2_sha256" || !iterations || !salt || !hash) return false;
  const candidate = pbkdf2Sync(password, salt, Number(iterations), 32, "sha256").toString("base64url");
  const left = Buffer.from(candidate);
  const right = Buffer.from(hash);
  return left.length === right.length && timingSafeEqual(left, right);
}

function channelRow(handle, topic, source, id) {
  return {
    id,
    title: titleFromHandle(handle),
    handle,
    topic,
    members: 8000 + Math.floor(Math.random() * 38000),
    growth: Number((4 + Math.random() * 11).toFixed(1)),
    engagement: Number((5 + Math.random() * 9).toFixed(1)),
    avgViews: 2500 + Math.floor(Math.random() * 12000),
    postsPerDay: 1 + Math.floor(Math.random() * 4),
    source,
    risk: "low",
    keywords: [topic.toLowerCase(), "telegram"],
    lastSignal: "Server source",
    status: "candidate"
  };
}

function titleFromHandle(handle) {
  return normalizeChannel(handle).replace(/^@/, "").split("_").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

function normalizeChannel(value) {
  return value.startsWith("https://t.me/") ? `@${value.split("/").filter(Boolean).at(-1) ?? ""}` : value;
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function token(prefix) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
  response.writeHead(204);
  response.end();
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function setCookie(response, name, value, days) {
  const maxAge = Math.floor(days * 24 * 60 * 60);
  const secure = config.secureCookies ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`);
}

function clearCookie(response, name) {
  const secure = config.secureCookies ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie ?? "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sendStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = resolve(config.publicDir, `.${safePath}`);
  if (!normalized.startsWith(config.publicDir)) return sendJson(response, 404, { error: "not_found" });
  const target = existsSync(normalized) ? normalized : resolve(config.publicDir, "index.html");
  response.writeHead(200, { "Content-Type": contentType(extname(target)) });
  response.end(readFileSync(target));
}

function contentType(ext) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  }[ext] ?? "application/octet-stream";
}

function cleanText(text) {
  return String(text ?? "").replace(/^```(?:json|text)?/i, "").replace(/```$/i, "").replace(/^["']|["']$/g, "").trim();
}

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
