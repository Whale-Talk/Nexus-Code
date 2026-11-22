import { MODEL_SELECTIONS } from './roles.js'
import { isModelAllowed } from './modelAllowlist.js'
import { sideQuery } from '../sideQuery.js'
import { getCatalogModel, getLegacyDeepSeekModelIds, getModelCatalog } from '../../services/api/provider/catalog.js'
import {
  NotFoundError,
  APIError,
  APIConnectionError,
  AuthenticationError,
} from '../../services/api/provider/errors.js'


/**
 * Validates a model by attempting an actual API call.
 */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()

  // Empty model is invalid
  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  // Check against availableModels allowlist before any API call
  if (!isModelAllowed(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  // Check if it's a known alias (these are always valid)
  const lowerModel = normalizedModel.toLowerCase()
  if ((MODEL_SELECTIONS as readonly string[]).includes(lowerModel)) {
    return { valid: true }
  }

  // A configured choice can be selected without making a separate inference request.
  if (getModelCatalog() ? getCatalogModel(normalizedModel) : getLegacyDeepSeekModelIds().includes(normalizedModel)) {
    return { valid: true }
  }

  // Check if it matches NEXUS_CUSTOM_MODEL_OPTION (pre-validated by the user)
  if (normalizedModel === process.env.NEXUS_CUSTOM_MODEL_OPTION) {
    return { valid: true }
  }

  // Try to make an actual API call with minimal parameters
  try {
    await sideQuery({
      model: normalizedModel,
      max_tokens: 1,
      maxRetries: 0,
      querySource: 'model_validation',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hi',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    })

    // If we got here, the model is valid
    return { valid: true }
  } catch (error) {
    return handleValidationError(error, normalizedModel)
  }
}

function handleValidationError(
  error: unknown,
  modelName: string,
): { valid: boolean; error: string } {
  // NotFoundError (404) means the model doesn't exist
  if (error instanceof NotFoundError) {
    return {
      valid: false,
      error: `Model '${modelName}' not found`,
    }
  }

  // For other API errors, provide context-specific messages
  if (error instanceof APIError) {
    if (error instanceof AuthenticationError) {
      return {
        valid: false,
        error: `${error.message}，请核对该渠道的密钥及模型访问权限。`,
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
      }
    }

    // Check error body for model-specific errors
    const errorBody = error.error as unknown
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'type' in errorBody &&
      errorBody.type === 'not_found_error' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string' &&
      errorBody.message.includes('model:')
    ) {
      return { valid: false, error: `Model '${modelName}' not found` }
    }

    // Generic API error
    return { valid: false, error: `API error: ${error.message}` }
  }

  // For unknown errors, be safe and reject
  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}
