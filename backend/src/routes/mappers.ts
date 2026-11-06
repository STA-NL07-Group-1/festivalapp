// Databaserijen → API-objecten (camelCase, zoals in api.yaml).
// Alleen velden die in api.yaml staan gaan naar buiten: nooit hashes of tellers.

type Row = Record<string, unknown>
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

export const toMe = (r: Row) => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  theme: r.theme,
  locale: r.locale,
  shareLocation: r.share_location,
  shareTimetable: r.share_timetable,
})

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
})

export const toStage = (r: Row) => ({
  id: r.id,
  name: r.name,
  latitude: r.latitude,
  longitude: r.longitude,
  capacity: r.capacity,
  sortOrder: r.sort_order,
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
