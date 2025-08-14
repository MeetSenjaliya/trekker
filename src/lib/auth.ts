import { supabase } from './supabase'
import { AuthError, User } from '@supabase/supabase-js'

export interface SignUpData {
  email: string
  password: string
  fullName: string
}

export interface SignInData {
  email: string
  password: string
}

export interface AuthResponse {
  user: User | null
  error: AuthError | null
}

// Sign up new user
export async function signUp({ email, password, fullName }: SignUpData): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    })

    if (error) {
      return { user: null, error }
    }

    // If signup successful, create user profile
    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .insert([
          {
            id: data.user.id,            // Must match auth.users.id
            full_name: fullName,         // Provided by form
            bio: null,                   // Optional field
            experience_level: null,      // Optional field
            emergency_contact: null,     // Optional field
            avatar_url: null,           // Optional field
            // created_at will auto-fill if your table has `default now()`
          },
        ]);

      if (profileError) {
        console.error('Error creating profile:', profileError);
        // Profile creation failed, but auth was successful
        // You might want to handle this differently based on your requirements
      }
    }

    return { user: data.user, error: null }
  } catch (error) {
    return { user: null, error: error as AuthError }
  }
}

// Sign in existing user
export async function signIn({ email, password }: SignInData): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    return { user: data.user, error }
  } catch (error) {
    return { user: null, error: error as AuthError }
  }
}

// Sign out user
export async function signOut(): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.signOut()
    return { error }
  } catch (error) {
    return { error: error as AuthError }
  }
}

// Reset password
export async function resetPassword(email: string): Promise<{ error: AuthError | null }> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    return { error }
  } catch (error) {
    return { error: error as AuthError }
  }
}

// Get current user
export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user
  } catch (error) {
    console.error('Error getting current user:', error)
    return null
  }
}

// Listen to auth state changes
export function onAuthStateChange(callback: (user: User | null) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null)
  })
}

