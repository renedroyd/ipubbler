import type { Env } from '../types'

export interface PublishRequest {
  destinationId: string
  message: string
  mediaKeys?: string[]
}

export interface PublishResult {
  providerId: string
  destinationId: string
}

/**
 * Provider boundary for social publication.
 *
 * This deliberately contains no Graph API assumptions about unsupported
 * destinations. The concrete Meta implementation will be enabled only after
 * the required permissions and destination capabilities are configured.
 */
export interface SocialPublisher {
  publish(request: PublishRequest): Promise<PublishResult>
}

export function createMetaPublisher(_env: Env): SocialPublisher {
  return {
    async publish(_request: PublishRequest): Promise<PublishResult> {
      throw new Error('Meta publishing adapter is not configured yet')
    },
  }
}
