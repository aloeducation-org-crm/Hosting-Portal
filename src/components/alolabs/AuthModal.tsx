'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthStore } from '@/stores/authStore';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'login' | 'signup';
}

/* -------------------------------------------------------------------------- */
/*  Password-strength helper                                                  */
/* -------------------------------------------------------------------------- */

function getPasswordStrength(pwd: string) {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return score; // 0-5
}

function strengthLabel(score: number) {
  if (score <= 1) return 'Weak';
  if (score <= 2) return 'Fair';
  if (score <= 3) return 'Good';
  if (score <= 4) return 'Strong';
  return 'Very strong';
}

function strengthColor(score: number) {
  if (score <= 1) return 'bg-red-500';
  if (score <= 2) return 'bg-orange-500';
  if (score <= 3) return 'bg-yellow-500';
  if (score <= 4) return 'bg-green-500';
  return 'bg-emerald-500';
}

/* -------------------------------------------------------------------------- */
/*  Login Form                                                                */
/* -------------------------------------------------------------------------- */

function LoginForm({
  onSwitchTab,
  onClose,
}: {
  onSwitchTab: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErrors({});

      const newErrors: { email?: string; password?: string } = {};
      if (!email.trim()) newErrors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        newErrors.email = 'Enter a valid email address';
      if (!password) newErrors.password = 'Password is required';
      if (Object.keys(newErrors).length) {
        setErrors(newErrors);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok || data.success === false) {
          setErrors({ password: data.message || data.error?.message || data.error || 'Invalid credentials' });
          return;
        }

        const user = data.data || data.user;
        const token = data.data?.token || data.token || 'session';
        setAuth(user, token);
        toast.success(`Welcome back, ${user?.name || 'User'}!`);
        onClose();
      } catch {
        setErrors({ password: 'Something went wrong. Please try again.' });
      } finally {
        setLoading(false);
      }
    },
    [email, password, setAuth, onClose],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="login-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-9"
            autoComplete="email"
          />
        </div>
        {errors.email && (
          <p className="text-sm text-red-500">{errors.email}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9 pr-10"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password && (
          <p className="text-sm text-red-500">{errors.password}</p>
        )}
      </div>

      {/* Remember me / Forgot */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={rememberMe}
            onCheckedChange={(checked) => setRememberMe(checked === true)}
          />
          <span className="text-sm text-muted-foreground">Remember me</span>
        </label>
        <a
          href="/login?recovery=1"
          className="text-sm text-[#E8501A] hover:text-[#C73D12] transition-colors"
        >
          Forgot password?
        </a>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {loading ? 'Logging in…' : 'Log in'}
      </button>

      {/* Switch to signup */}
      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSwitchTab}
          className="text-[#E8501A] hover:text-[#C73D12] font-medium transition-colors"
        >
          Sign up
        </button>
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Signup Form                                                               */
/* -------------------------------------------------------------------------- */

function SignupForm({
  onSwitchTab,
  onClose,
}: {
  onSwitchTab: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setAuth = useAuthStore((s) => s.setAuth);

  const pwdStrength = getPasswordStrength(password);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErrors({});

      const newErrors: Record<string, string> = {};
      if (!name.trim()) newErrors.name = 'Name is required';
      if (!email.trim()) newErrors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        newErrors.email = 'Enter a valid email address';
      if (!password) newErrors.password = 'Password is required';
      else if (password.length < 8)
        newErrors.password = 'Password must be at least 8 characters';
      if (password !== confirmPassword)
        newErrors.confirmPassword = 'Passwords do not match';
      if (!agreed) newErrors.agreed = 'You must agree to the Terms of Service';

      if (Object.keys(newErrors).length) {
        setErrors(newErrors);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });

        const data = await res.json();

        if (!res.ok || data.success === false) {
          setErrors({ email: data.message || data.error?.message || data.error || 'Signup failed' });
          return;
        }

        const user = data.data || data.user;
        const token = data.data?.token || data.token || 'session';
        setAuth(user, token);
        toast.success(`Account created! Welcome, ${user?.name || 'User'}!`);
        onClose();
      } catch {
        setErrors({ email: 'Something went wrong. Please try again.' });
      } finally {
        setLoading(false);
      }
    },
    [name, email, password, confirmPassword, agreed, setAuth, onClose],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Name</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-name"
            type="text"
            placeholder="Your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="pl-9"
            autoComplete="name"
          />
        </div>
        {errors.name && (
          <p className="text-sm text-red-500">{errors.name}</p>
        )}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-9"
            autoComplete="email"
          />
        </div>
        {errors.email && (
          <p className="text-sm text-red-500">{errors.email}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9 pr-10"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {errors.password && (
          <p className="text-sm text-red-500">{errors.password}</p>
        )}

        {/* Password strength indicator */}
        {password.length > 0 && (
          <div className="space-y-1">
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i < pwdStrength ? strengthColor(pwdStrength) : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {strengthLabel(pwdStrength)}
            </p>
          </div>
        )}
      </div>

      {/* Confirm Password */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-confirm-password">Confirm password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-confirm-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="pl-9"
            autoComplete="new-password"
          />
        </div>
        {errors.confirmPassword && (
          <p className="text-sm text-red-500">{errors.confirmPassword}</p>
        )}
      </div>

      {/* Terms */}
      <div className="space-y-1">
        <label className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            className="mt-0.5"
          />
          <span className="text-sm text-muted-foreground leading-snug">
            I agree to the{' '}
            <a href="/terms" className="text-[#E8501A] hover:text-[#C73D12] transition-colors">
              Terms of Service
            </a>
          </span>
        </label>
        {errors.agreed && (
          <p className="text-sm text-red-500">{errors.agreed}</p>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {loading ? 'Creating account…' : 'Create account'}
      </button>

      {/* Switch to login */}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchTab}
          className="text-[#E8501A] hover:text-[#C73D12] font-medium transition-colors"
        >
          Log in
        </button>
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  AuthModal                                                                 */
/* -------------------------------------------------------------------------- */

export default function AuthModal({ open, onOpenChange, defaultTab = 'login' }: AuthModalProps) {
  const [tab, setTab] = useState<'login' | 'signup'>(defaultTab);

  // Sync external defaultTab changes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setTab(defaultTab);
      }
      onOpenChange(nextOpen);
    },
    [defaultTab, onOpenChange],
  );

  const handleSwitchToSignup = useCallback(() => setTab('signup'), []);
  const handleSwitchToLogin = useCallback(() => setTab('login'), []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-xl font-bold text-center text-[#1E293B]">
            {tab === 'login' ? 'Welcome back' : 'Create your account'}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'login' | 'signup')} className="mt-2">
          <div className="px-6">
            <TabsList className="w-full h-10 bg-gray-100 rounded-lg p-1">
              <TabsTrigger
                value="login"
                className="flex-1 h-8 rounded-md text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-[#1E293B] text-muted-foreground transition-all"
              >
                Log in
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="flex-1 h-8 rounded-md text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-[#1E293B] text-muted-foreground transition-all"
              >
                Sign up
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="login" className="px-6 pb-6 pt-4">
            <LoginForm onSwitchTab={handleSwitchToSignup} onClose={() => onOpenChange(false)} />
          </TabsContent>

          <TabsContent value="signup" className="px-6 pb-6 pt-4">
            <SignupForm onSwitchTab={handleSwitchToLogin} onClose={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}