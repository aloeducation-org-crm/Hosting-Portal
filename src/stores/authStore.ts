import { create } from 'zustand'

interface User {
  id: string
  name: string | null
  email: string
  role?: string
  permissions?: string[]
  isActive?: boolean
  plan?: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
  checkSession: () => Promise<void>
  setAuth: (user: User, token: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (user, _token) => {
    set({ user, isAuthenticated: true, isLoading: false })
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })

      if (!res.ok) {
        const body = await res.json()
        const errMsg = body?.error?.message || body?.error || 'Login failed'
        throw new Error(errMsg)
      }

      const body = await res.json()
      // API returns { success: true, data: { id, email, name, role, permissions } }
      const userData = body.data
      set({
        user: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          role: userData.role,
          permissions: userData.permissions,
        },
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  signup: async (name: string, email: string, password: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
        credentials: 'include',
      })

      if (!res.ok) {
        const body = await res.json()
        const errMsg = body?.error?.message || body?.error || 'Signup failed'
        throw new Error(errMsg)
      }

      const body = await res.json()
      const userData = body.data
      set({
        user: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          role: userData.role,
        },
        isAuthenticated: true,
        isLoading: false,
      })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },

  logout: () => {
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    })
  },

  checkSession: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/auth/session', {
        credentials: 'include',
      })
      if (res.ok) {
        const body = await res.json()
        const userData = body.data
        set({
          user: {
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role,
            permissions: userData.permissions,
            isActive: userData.isActive,
          },
          isAuthenticated: true,
          isLoading: false,
        })
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
