import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../shared/apiClient';

type User = {
  _id: string;
  username: string;
  email: string;
  role: 'manager' | 'admin' | 'accountant' | 'service_manager' | 'sales_head';
  fullName?: string;
  /** Строка в JWT; объект после populate в /api/auth/me */
  cityId?: string | { _id: string; name?: string; code?: string };
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      // Verify token and get user info
      api.get('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } })
        .then((res) => {
          setUser(res.data);
        })
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post('/api/auth/login', { username, password });
    const { token: newToken } = res.data;
    setToken(newToken);
    localStorage.setItem('token', newToken);
    const me = await api.get('/api/auth/me');
    const userData = me.data;
    setUser(userData);
    return userData;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

