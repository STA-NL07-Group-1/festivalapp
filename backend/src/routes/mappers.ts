// Databaserijen → API-objecten (camelCase, zoals in api.yaml).
// Alleen velden die in api.yaml staan gaan naar buiten: nooit hashes of tellers.

type Row = Record<string, unknown>
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

/** `ctx` levert de rol en het festival van dit verzoek (zie app.ts) */
export const toMe = (r: Row, ctx: { user: { role: string; platformRole: string | null } | null; festivalId: string | null }) => ({
  id: r.id,
  email: r.email,
  emailVerified: r.email_verified_at != null,
  displayName: r.display_name,
  role: ctx.user?.role ?? 'bezoeker',
  platformRole: ctx.user?.platformRole ?? null,
  festivalId: ctx.festivalId,
  theme: r.theme,
  locale: r.locale,
  shareLocation: r.share_location,
  shareTimetable: r.share_timetable,
  notifyChat: r.notify_chat,
  notifyTimetable: r.notify_timetable,
  notifyAnnouncements: r.notify_announcements,
})

export const toAdminUser = (r: Row) => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  ticketType: r.ticket_type ?? null,
  // 'alle' = geblokkeerd voor alle festivals, 'festival' = alleen voor dit festival
  blocked: r.blocked_at != null || r.festival_blocked_at != null,
  blockScope: r.blocked_at != null ? 'alle' : r.festival_blocked_at != null ? 'festival' : null,
  blockedReason: r.blocked_at != null ? (r.blocked_reason ?? null) : (r.festival_block_reason ?? null),
  createdAt: iso(r.created_at),
})

export const toFestival = (f: { id: string; name: string; startsAt: Date; endsAt: Date; role: string; ticketType?: string | null }) => ({
  id: f.id,
  name: f.name,
  startsAt: f.startsAt.toISOString(),
  endsAt: f.endsAt.toISOString(),
  role: f.role,
  ticketType: f.ticketType ?? null,
  active: f.startsAt.getTime() <= Date.now() && f.endsAt.getTime() > Date.now(),
})

export const toTeamMember = (r: Row) => ({
  userId: r.user_id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  addedAt: iso(r.created_at),
})

export const toOwner = (r: Row) => ({ userId: r.id, email: r.email, displayName: r.display_name, platformRole: r.platform_role })

export const toFriend = (r: Row) => ({ id: r.id, displayName: r.display_name, since: iso(r.since) })

export const toFriendLocation = (r: Row) => ({
  userId: r.user_id,
  displayName: r.display_name,
  latitude: r.latitude,
  longitude: r.longitude,
  accuracyM: r.accuracy_m ?? null,
  recordedAt: iso(r.recorded_at),
})

export const toPin = (r: Row) => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  latitude: r.latitude,
  longitude: r.longitude,
  visibility: r.visibility,
  createdAt: iso(r.created_at),
})

export const toMessage = (r: Row) => ({
  id: r.id,
  senderId: r.sender_id,
  recipientId: r.recipient_id,
  body: r.body,
  createdAt: iso(r.created_at),
  readAt: iso(r.read_at),
  clientId: r.client_id ?? null,
})

export const toStage = (r: Row) => ({
  id: r.id,
  name: r.name,
  latitude: r.latitude,
  longitude: r.longitude,
  capacity: r.capacity,
  sortOrder: r.sort_order,
})

export const MAP_POINT_COLUMNS = 'id, kind, name, description, latitude, longitude'

export const toMapPoint = (r: Row) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description ?? null,
  latitude: r.latitude,
  longitude: r.longitude,
})

export const toPerformance = (r: Row) => ({
  id: r.id,
  stageId: r.stage_id,
  artist: r.artist,
  description: r.description ?? null,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  status: r.status,
  signupCapacity: r.signup_capacity ?? null,
})

export const toSignup = (r: Row) => ({
  performanceId: r.performance_id,
  createdAt: iso(r.created_at),
  checkedInAt: iso(r.checked_in_at),
})

export const toCrowd = (r: Row) => ({
  stageId: r.stage_id,
  level: r.level,
  headCount: r.head_count,
  measuredAt: iso(r.measured_at),
})

export const toAnnouncement = (r: Row) => ({
  id: r.id,
  level: r.level,
  titleNl: r.title_nl,
  titleEn: r.title_en,
  bodyNl: r.body_nl,
  bodyEn: r.body_en,
  createdAt: iso(r.created_at),
  expiresAt: iso(r.expires_at),
})

export const toSos = (r: Row) => ({
  id: r.id,
  userId: r.user_id ?? null,
  latitude: r.latitude ?? null,
  longitude: r.longitude ?? null,
  message: r.message ?? null,
  status: r.status,
  createdAt: iso(r.created_at),
  resolvedAt: iso(r.resolved_at),
})

export const PERFORMANCE_COLUMNS = 'id, stage_id, artist, description, starts_at, ends_at, status, signup_capacity'

export const toFaqItem = (r: Row) => ({
  id: r.id,
  questionNl: r.question_nl,
  questionEn: r.question_en,
  answerNl: r.answer_nl,
  answerEn: r.answer_en,
  sortOrder: r.sort_order,
})

export const FAQ_COLUMNS = 'id, question_nl, question_en, answer_nl, answer_en, sort_order'

export const toLostItem = (r: Row) => ({
  id: r.id,
  description: r.description,
  foundWhere: r.found_where ?? null,
  foundAt: iso(r.found_at),
  status: r.status,
  collectedAt: iso(r.collected_at),
})

export const LOST_ITEM_COLUMNS = 'id, description, found_where, found_at, status, collected_at'
