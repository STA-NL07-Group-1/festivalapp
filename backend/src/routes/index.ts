import type { Deps } from '../app.ts'
import type { Router } from '../http.ts'
import { authRoutes } from './auth.ts'
import { chatbotRoutes } from './chatbot.ts'
import { contentRoutes } from './content.ts'
import { festivalRoutes } from './festivals.ts'
import { mapRoutes } from './map.ts'
import { organisationRoutes } from './organisation.ts'
import { programRoutes } from './program.ts'
import { socialRoutes } from './social.ts'
import { userRoutes } from './users.ts'

export function registerRoutes(router: Router, deps: Deps): void {
  authRoutes(router, deps)
  socialRoutes(router, deps)
  festivalRoutes(router, deps)
  programRoutes(router, deps)
  mapRoutes(router, deps)
  contentRoutes(router, deps)
  userRoutes(router, deps)
  organisationRoutes(router, deps)
  chatbotRoutes(router, deps)
}
