// The real server side of sync, over the Supabase API.

// A Postgres/PostgREST error about one row has a 5-character SQLSTATE code (23503 foreign key,
// 23514 check, 42501 permission ...). Anything else (no network, expired login, 5xx) is not the
// row's fault, so it stops the whole sync and the rows keep waiting.
const isRowError = (e) => /^[0-9A-Z]{5}$/.test(e?.code || '')

function toError(e) {
  const err = new Error(e?.message || 'Sync failed')
  err.code = e?.code
  err.fatal = !isRowError(e)
  return err
}

export function createSupabaseRemote(supabase) {
  return {
    async upsert(table, rows) {
      let res
      try {
        res = await supabase.from(table).upsert(rows, { onConflict: 'id' })
      } catch (e) {
        throw Object.assign(new Error(e?.message || 'Network error'), { fatal: true })
      }
      if (res.error) throw toError(res.error)
    },

    async selectSince(table, cursor, limit) {
      let q = supabase.from(table).select('*')
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (cursor) q = q.or(`updated_at.gt.${cursor.ts},and(updated_at.eq.${cursor.ts},id.gt.${cursor.id})`)
      let res
      try {
        res = await q
      } catch (e) {
        throw Object.assign(new Error(e?.message || 'Network error'), { fatal: true })
      }
      if (res.error) throw Object.assign(toError(res.error), { fatal: true })
      return res.data
    },
  }
}
