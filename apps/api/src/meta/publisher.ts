import type { Env } from '../types'
import { decryptMetaToken, MetaClient, requireMetaEncryptionSecret } from '../meta'

export interface PublishRequest {
  destinationId: string
  message: string
  mediaKeys?: string[]
}

export interface PublishResult {
  providerId: string
  destinationId: string
}

export interface SocialPublisher {
  publish(request: PublishRequest): Promise<PublishResult>
}

export function createMetaPublisher(env: Env, userId: string): SocialPublisher {
  return {
    async publish(request) {
      const destination = await env.DB.prepare(`
        SELECT d.id,d.type,d.provider_id,d.access_token_encrypted
        FROM destinations d
        JOIN facebook_accounts a ON a.id=d.facebook_account_id
        WHERE d.id=? AND a.user_id=?
      `).bind(request.destinationId, userId).first<{
        id: string
        type: 'page' | 'profile' | 'group'
        provider_id: string
        access_token_encrypted: string | null
      }>()

      if (!destination) throw new Error('Destino no encontrado')
      if (destination.type !== 'page') throw new Error(`El destino ${destination.type} todavía no tiene un adaptador de publicación habilitado`)
      if (!destination.access_token_encrypted) throw new Error('El destino no tiene un token de acceso configurado')

      const secret = requireMetaEncryptionSecret(env)
      const pageAccessToken = await decryptMetaToken(destination.access_token_encrypted, secret)
      const meta = new MetaClient(env)
      const result = await meta.publishPagePost(destination.provider_id, pageAccessToken, request.message)
      return { providerId: result.id, destinationId: destination.id }
    },
  }
}
