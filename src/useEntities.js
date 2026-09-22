import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/** The active businesses, for the entity filter every report carries.
 *  Value is the code (what the functions take); label is the full name. */
export function useEntities() {
  const [entities, setEntities] = useState([])
  useEffect(() => {
    supabase.from('businesses').select('code,name').eq('active', true).order('code')
      .then(({ data }) => setEntities(data || []))
  }, [])
  return entities
}
