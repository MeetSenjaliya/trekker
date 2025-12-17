import { supabase, Trek, TrekParticipant, Review, User } from './supabase'

// Trek-related functions
export async function getTraks(): Promise<Trek[]> {
  try {
    const { data, error } = await supabase
      .from('treks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching treks:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error fetching treks:', error)
    return []
  }
}

export async function getTrekById(id: string): Promise<Trek | null> {
  try {
    const { data, error } = await supabase
      .from('treks')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching trek:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error fetching trek:', error)
    return null
  }
}

export async function createTrek(trek: Omit<Trek, 'id' | 'created_at' | 'updated_at'>): Promise<Trek | null> {
  try {
    const { data, error } = await supabase
      .from('treks')
      .insert([{
        ...trek,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (error) {
      console.error('Error creating trek:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error creating trek:', error)
    return null
  }
}

// Participant-related functions
export async function joinTrek(trekId: string, userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('trek_participants')
      .insert([{
        trek_id: trekId,
        user_id: userId,
        status: 'confirmed',
        joined_at: new Date().toISOString(),
      }])

    if (error) {
      console.error('Error joining trek:', error)
      return false
    }

    // Update participant count
    const { error: updateError } = await supabase.rpc('increment_participants', {
      trek_id: trekId
    })

    if (updateError) {
      console.error('Error updating participant count:', updateError)
    }

    return true
  } catch (error) {
    console.error('Error joining trek:', error)
    return false
  }
}

export async function getTrekParticipants(trekId: string): Promise<TrekParticipant[]> {
  try {
    const { data, error } = await supabase
      .from('trek_participants')
      .select('*')
      .eq('trek_id', trekId)
      .eq('status', 'confirmed')

    if (error) {
      console.error('Error fetching participants:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error fetching participants:', error)
    return []
  }
}

// Review-related functions
export async function createReview(review: Omit<Review, 'id' | 'created_at' | 'updated_at'>): Promise<Review | null> {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .insert([{
      
        ...review,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
      .select()
      .single()

    if (error) {
      console.error('Error creating review:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error creating review:', error)
    return null
  }
}

export async function getTrekReviews(trekId: string): Promise<Review[]> {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('trek_id', trekId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching reviews:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error fetching reviews:', error)
    return []
  }
}

// User profile functions
export async function getUserProfile(userId: string): Promise<User | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching user profile:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
}

export async function updateUserProfile(userId: string, updates: Partial<User>): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) {
      console.error('Error updating user profile:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error updating user profile:', error)
    return false
  }
}

