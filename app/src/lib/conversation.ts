// Een open gesprek: met één vriend of met een groep (zie ChatScreen)
import type { Friend, Group } from '../api/client'

export type Conversation = { type: 'friend'; friend: Friend } | { type: 'group'; group: Group }

/** Sleutel voor React: bij een ander gesprek begint het chatscherm opnieuw */
export const conversationKey = (c: Conversation) => (c.type === 'friend' ? `friend:${c.friend.id}` : `group:${c.group.id}`)
