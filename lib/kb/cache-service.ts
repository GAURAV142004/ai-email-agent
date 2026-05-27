import { SupabaseClient } from '@supabase/supabase-js'
import { generateEmbedding, formatVectorLiteral } from './embeddings'

export interface CachedResponse {
  responseText:              string
  responseType:              string
  kbEntriesReferenced:       number
  projectClustersReferenced: string[]
}

/**
 * Checks the semantic cache for similar queries (similarity >= 0.95)
 */
export async function getSemanticCache(
  supabase:  SupabaseClient,
  queryText: string,
): Promise<CachedResponse | null> {
  try {
    const queryEmbedding = await generateEmbedding(queryText)
    const vectorLiteral  = formatVectorLiteral(queryEmbedding)

    const { data, error } = await supabase.rpc('match_semantic_cache', {
      query_embedding: vectorLiteral,
      match_threshold: 0.95, // 95% threshold for semantic equivalence
    })

    if (error || !data || data.length === 0) return null

    const cached = data[0]
    return {
      responseText:              cached.response_text,
      responseType:              cached.response_type,
      kbEntriesReferenced:       cached.kb_entries_referenced,
      projectClustersReferenced: cached.project_clusters_referenced,
    }
  } catch (err) {
    console.error('[Semantic Cache] Read error:', err)
    return null
  }
}

/**
 * Saves an agent query response to the semantic cache
 */
export async function setSemanticCache(
  supabase:  SupabaseClient,
  queryText: string,
  response:  CachedResponse,
): Promise<void> {
  try {
    const queryEmbedding = await generateEmbedding(queryText)
    
    await supabase.from('semantic_cache').insert({
      query_text:                  queryText,
      embedding:                   queryEmbedding,
      response_text:               response.responseText,
      response_type:               response.responseType,
      kb_entries_referenced:       response.kbEntriesReferenced,
      project_clusters_referenced: response.projectClustersReferenced,
    })
  } catch (err) {
    console.error('[Semantic Cache] Write error:', err)
  }
}
